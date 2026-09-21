"""Lazy VibeVoice adapter: no model download at service startup.

Install the official VibeVoice checkout separately in the GPU/CPU environment.
No mock fallback is used when the real model is unavailable.
"""

import os
from pathlib import Path


class IncompleteOutput(RuntimeError):
    def __init__(self, message, raw):
        super().__init__(message)
        self.raw = raw


def compact_streaming_cache(cache_class):
    """Detach AND copy tails: a view otherwise retains the whole convolution input."""

    def store_tail(self, layer_id, sample_indices, states):
        for index, sample in enumerate(sample_indices.tolist()):
            self.cache[(layer_id, sample)] = states[index].detach().clone()

    cache_class.set = store_tail


class VibeVoice:
    def __init__(self):
        import torch
        from vibevoice.modular.modeling_vibevoice_asr import (
            VibeVoiceASRForConditionalGeneration,
        )
        from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor
        from vibevoice.modular.modular_vibevoice_tokenizer import (
            VibeVoiceTokenizerStreamingCache,
        )

        compact_streaming_cache(VibeVoiceTokenizerStreamingCache)

        self.torch = torch
        self.device = os.getenv(
            "VIBEVOICE_DEVICE", "cuda" if torch.cuda.is_available() else "cpu"
        )
        model = os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-ASR")
        dtype = torch.float32 if self.device in ("cpu", "mps") else torch.bfloat16
        self.quantization = os.getenv("VIBEVOICE_QUANTIZATION", "none")
        self.revision = os.getenv("VIBEVOICE_REVISION") or None
        common = (
            {"revision": self.revision}
            if self.revision and not Path(model).exists()
            else {}
        )
        tokenizer = os.getenv("VIBEVOICE_TOKENIZER", "Qwen/Qwen2.5-7B")
        # Reuse the pinned downloaded tokenizer without a network HEAD on each job.
        if tokenizer == "Qwen/Qwen2.5-7B" and os.getenv("HF_HOME"):
            cached = (
                Path(os.environ["HF_HOME"])
                / "hub/models--Qwen--Qwen2.5-7B/snapshots/d149729398750b98c0af14eb82c78cfe92750796"
            )
            if (cached / "tokenizer.json").exists() and (
                cached / "tokenizer_config.json"
            ).exists():
                tokenizer = str(cached)
        self.processor = VibeVoiceASRProcessor.from_pretrained(
            model, language_model_pretrained_name=tokenizer
        )
        options = dict(common)
        if self.quantization == "4bit":
            if not torch.cuda.is_available():
                raise RuntimeError("4-bit deployment requires a CUDA GPU")
            from transformers import BitsAndBytesConfig

            # Keep speech encoders/connectors in their training dtype; quantize only the LM.
            options["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=dtype,
                llm_int8_skip_modules=[
                    "acoustic_tokenizer",
                    "semantic_tokenizer",
                    "acoustic_connector",
                    "semantic_connector",
                ],
            )
            options["device_map"] = {"": 0}
        elif self.quantization != "none":
            raise ValueError("VIBEVOICE_QUANTIZATION must be none or 4bit")
        elif self.device == "auto":
            options["device_map"] = "auto"
        self.model = VibeVoiceASRForConditionalGeneration.from_pretrained(
            model,
            dtype=dtype,
            attn_implementation=os.getenv("VIBEVOICE_ATTENTION", "sdpa"),
            **options,
        )
        if self.device != "auto" and self.quantization == "none":
            self.model.to(self.device)
        self.input_device = next(self.model.parameters()).device
        self.model.eval()
        self.offload_speech = (
            self.quantization == "4bit"
            and os.getenv("VIBEVOICE_OFFLOAD_SPEECH", "1") == "1"
        )
        self.speech_modules = [
            getattr(self.model.model, name)
            for name in (
                "acoustic_tokenizer",
                "semantic_tokenizer",
                "acoustic_connector",
                "semantic_connector",
            )
        ]
        self.encoder_segment_seconds = float(
            os.getenv("VIBEVOICE_ENCODER_SEGMENT_SECONDS", "20")
        )
        if not 1 <= self.encoder_segment_seconds <= 60:
            raise ValueError("Encoder streaming segment must be 1–60 seconds")
        original_encode_speech = self.model.encode_speech

        def encode_speech(*args, **kwargs):
            kwargs["streaming_segment_duration"] = self.encoder_segment_seconds
            features = original_encode_speech(*args, **kwargs)
            if self.offload_speech:
                for module in self.speech_modules:
                    module.to("cpu")
            if self.torch.cuda.is_available():
                # Convolution workspaces are no longer needed during LM decoding.
                self.torch.cuda.empty_cache()
                print(
                    f"CUDA after speech encoding: allocated={self.torch.cuda.memory_allocated()} reserved={self.torch.cuda.memory_reserved()}",
                    flush=True,
                )
            return features

        self.model.encode_speech = encode_speech
        # Generation consumes only the last token's logits. The upstream ASR forward
        # otherwise projects every audio/prompt token into a 152k vocabulary, causing
        # a needless multi-GB prefill allocation on long meetings. KV state is unchanged.
        self.model.lm_head.register_forward_pre_hook(
            lambda module, args: (args[0][:, -1:, :],)
        )

    def transcribe(self, path, context_info=""):
        # Windows WDDM can page out model weights when the allocator retains the
        # previous window's unused KV/prefill blocks. Release only unused blocks.
        if self.torch.cuda.is_available():
            import gc

            gc.collect()
            self.torch.cuda.empty_cache()
            print(
                f"CUDA before window: allocated={self.torch.cuda.memory_allocated()} reserved={self.torch.cuda.memory_reserved()}",
                flush=True,
            )
        if self.offload_speech:
            for module in self.speech_modules:
                module.to(self.input_device)
        inputs = self.processor(
            audio=[str(path)],
            return_tensors="pt",
            padding=True,
            add_generation_prompt=True,
            context_info=context_info,
        )
        inputs = {
            k: v.to(self.input_device) if isinstance(v, self.torch.Tensor) else v
            for k, v in inputs.items()
        }
        limit = int(os.getenv("VIBEVOICE_MAX_TOKENS", "32768"))
        with self.torch.inference_mode():
            output = self.model.generate(
                **inputs,
                do_sample=False,
                max_new_tokens=limit,
                max_time=float(os.getenv("VIBEVOICE_GENERATION_SECONDS", "600")),
                pad_token_id=self.processor.pad_id,
                eos_token_id=self.processor.tokenizer.eos_token_id,
            )
        generated = output[0, inputs["input_ids"].shape[1] :]
        raw = self.processor.decode(generated, skip_special_tokens=True)
        if (
            not len(generated)
            or generated[-1].item() != self.processor.tokenizer.eos_token_id
        ):
            raise IncompleteOutput(
                "Model output truncated or generation time limit reached", raw
            )
        try:
            segments = self.processor.post_process_transcription(raw)
        except (ValueError, TypeError) as exc:
            raise IncompleteOutput(
                f"VibeVoice output could not be parsed: {type(exc).__name__}", raw
            ) from exc
        if not isinstance(segments, list):
            raise IncompleteOutput("VibeVoice did not return a segment list", raw)
        if not segments and raw.strip() not in ("", "[]"):
            raise IncompleteOutput(
                "VibeVoice output could not be parsed; raw output was not accepted", raw
            )
        return segments, raw
