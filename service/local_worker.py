"""Bundled offline CPU worker. JSON progress on stdout; no HTTP or downloads."""

import argparse
import gc
import json
import math
from pathlib import Path
import sys
import uuid
import wave

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from service.lightweight import SpeakerTimeline, align_tokens, diarize  # noqa: E402
from service.lightweight_models import digest  # noqa: E402
from service.speakers import reconcile_turns, turn_samples, unit  # noqa: E402


def progress(step):
    print(
        json.dumps({"type": "progress", "step": step}, ensure_ascii=False), flush=True
    )


def verify_models(root, language, task):
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    required = {"campplus.onnx"}
    if task == "transcribe":
        required.update(("silero.onnx", "segmentation.onnx"))
        if language == "zh":
            required.update(
                (
                    "qwen3/conv_frontend.onnx",
                    "qwen3/encoder.int8.onnx",
                    "qwen3/decoder.int8.onnx",
                )
            )
            tokenizer = [
                name
                for name in manifest["files"]
                if name.startswith("qwen3/tokenizer/")
            ]
            if not tokenizer:
                raise ValueError("Missing Qwen tokenizer manifest")
            required.update(tokenizer)
        else:
            required.update(("sensevoice.int8.onnx", "tokens.txt"))
    for name in required:
        path = (root / name).resolve()
        expected = manifest["files"].get(name)
        if (
            not expected
            or not path.is_relative_to(root)
            or not path.is_file()
            or digest(path) != expected["sha256"]
        ):
            raise ValueError(f"Model verification failed: {name}")
    return manifest


def resolve_speakers(wav, models, segments, threads, names=None, expected=None):
    import numpy as np
    import sherpa_onnx as sherpa

    ranges, vectors = turn_samples(segments), {}
    extractor = sherpa.SpeakerEmbeddingExtractor(
        sherpa.SpeakerEmbeddingExtractorConfig(
            model=str(models / "campplus.onnx"),
            provider="cpu",
            num_threads=threads,
        )
    )
    with wave.open(str(wav), "rb") as source:
        for index, (sid, sample) in enumerate(ranges.items()):
            source.setpos(min(source.getnframes(), int(sample["start"] * 16000)))
            audio = (
                np.frombuffer(
                    source.readframes(int((sample["end"] - sample["start"]) * 16000)),
                    dtype="<i2",
                ).astype(np.float32)
                / 32768
            )
            vector = None
            if (
                len(audio) >= 12800
                and float(np.sqrt(np.mean(audio * audio))) >= 10 / 32768
            ):
                stream = extractor.create_stream()
                stream.accept_waveform(16000, audio)
                stream.input_finished()
                if extractor.is_ready(stream):
                    vector = unit(extractor.compute(stream))
            vectors[sid] = vector
            if index % 25 == 0:
                progress(f"本机统一说话人 {index + 1}/{len(ranges)}")
    result = reconcile_turns(
        segments, vectors, ranges, names=names, expected_speakers=expected
    )
    result["speaker_resolution"].update(
        model="CAM++ zh/en", model_sha256=digest(models / "campplus.onnx")
    )
    return result


def speaker_for_interval(start, end, timeline):
    boundaries = [start, *(t for t in timeline.times if start < t < end), end]
    weights = {}
    for left, right in zip(boundaries, boundaries[1:]):
        label = timeline.at((left + right) / 2)
        weights[label] = weights.get(label, 0) + right - left
    label, weight = max(weights.items(), key=lambda item: item[1])
    return label if weight >= 0.8 * (end - start) else "unknown"


def speech_pieces(start, end, timeline):
    """Split at stable speaker changes; retain every sample and avoid tiny pieces."""
    cursor, label = start, timeline.at(start)
    for point in timeline.times:
        if point <= start or point >= end:
            continue
        next_label = timeline.at(point)
        if (
            next_label != label
            and next_label != "unknown"
            and point - cursor >= 2
            and end - point >= 2
        ):
            yield cursor, point
            cursor = point
        label = next_label
    yield cursor, end


def transcribe(request, models, wav, duration):
    import numpy as np
    import sherpa_onnx as sherpa

    threads, language = request["threads"], request["language"]
    progress("本机识别说话人")
    turns = diarize(
        wav,
        models,
        threads,
        embedding_model=models / "campplus.onnx",
        progress=lambda step: progress("本机识别说话人 " + step.split()[-1]),
    )
    # Boundaries are acoustic observations. Reconciliation never guesses identity from text.
    turn_segments = [{**t, "id": str(uuid.uuid4()), "text": "speech"} for t in turns]
    resolved = resolve_speakers(wav, models, turn_segments, threads)
    timeline = SpeakerTimeline(resolved["segments"])
    del turns, turn_segments
    gc.collect()
    progress("加载中文转写模型" if language == "zh" else "加载英文转写模型")
    if language == "zh":
        qwen = models / "qwen3"
        recognizer = sherpa.OfflineRecognizer.from_qwen3_asr(
            conv_frontend=str(qwen / "conv_frontend.onnx"),
            encoder=str(qwen / "encoder.int8.onnx"),
            decoder=str(qwen / "decoder.int8.onnx"),
            tokenizer=str(qwen / "tokenizer"),
            provider="cpu",
            num_threads=threads,
            max_total_len=1024,
            max_new_tokens=512,
            hotwords=", ".join(request.get("keywords", []))[:1024],
        )
    else:
        recognizer = sherpa.OfflineRecognizer.from_sense_voice(
            model=str(models / "sensevoice.int8.onnx"),
            tokens=str(models / "tokens.txt"),
            provider="cpu",
            num_threads=threads,
            language="en",
            use_itn=True,
        )
    config = sherpa.VadModelConfig()
    config.silero_vad.model = str(models / "silero.onnx")
    config.silero_vad.min_silence_duration = 0.5
    config.silero_vad.max_speech_duration = 20
    config.sample_rate = 16000
    config.num_threads = 1
    config.provider = "cpu"
    vad = sherpa.VoiceActivityDetector(config, buffer_size_in_seconds=60)
    namespace, segments, raw = uuid.uuid4(), [], []

    def drain():
        while not vad.empty():
            speech = vad.front
            start, end = (
                speech.start / 16000,
                min(duration, (speech.start + len(speech.samples)) / 16000),
            )
            if start < end:
                pieces = (
                    speech_pieces(start, end, timeline)
                    if language == "zh"
                    else [(start, end)]
                )
                for left, right in pieces:
                    stream = recognizer.create_stream()
                    stream.accept_waveform(
                        16000,
                        speech.samples[
                            round((left - start) * 16000) : round(
                                (right - start) * 16000
                            )
                        ],
                    )
                    recognizer.decode_stream(stream)
                    result = stream.result
                    text = result.text.strip()
                    # Do not silently accept near-empty output from a substantial VAD region.
                    short = not text or (
                        right - left >= 4
                        and (
                            len("".join(c for c in text if c.isalnum())) <= 2
                            or (text.isascii() and len(text.split()) <= 1)
                        )
                    )
                    raw.append(
                        {
                            "start": left,
                            "end": right,
                            "text": text,
                            "needsReview": short,
                        }
                    )
                    if (
                        language == "en"
                        and result.tokens
                        and result.timestamps
                        and not short
                    ):
                        segments.extend(
                            align_tokens(
                                list(result.tokens),
                                list(result.timestamps),
                                left,
                                right,
                                timeline,
                                namespace,
                            )
                        )
                    elif text or short:
                        segments.append(
                            {
                                "id": str(
                                    uuid.uuid5(namespace, f"{left:.6f}:{right:.6f}")
                                ),
                                "start": left,
                                "end": right,
                                "speaker": speaker_for_interval(left, right, timeline),
                                "text": text,
                                "needsReview": short,
                            }
                        )
            vad.pop()

    with wave.open(str(wav), "rb") as source:
        frames, last = 0, -1
        while pcm := source.readframes(512):
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            frames += len(samples)
            vad.accept_waveform(np.pad(samples, (0, 512 - len(samples))))
            drain()
            percent = min(100, int(100 * frames / source.getnframes()))
            if percent != last:
                progress(f"本机转写 {percent}%")
                last = percent
        vad.flush()
        drain()
    return {
        "segments": segments,
        "raw": raw,
        "speaker_resolution": resolved["speaker_resolution"],
        "configuration": {
            "engine": "qwen3-0.6b-int8" if language == "zh" else "sensevoice-int8",
            "language": language,
            "provider": "cpu",
            "threads": threads,
            "timestamp_method": "acoustic segment boundaries"
            if language == "zh"
            else "CTC token onsets",
        },
        "review_required": sum(bool(s.get("needsReview")) for s in segments),
    }


def run(request):
    if request.get("language") not in ("zh", "en") or request.get("task") not in (
        "transcribe",
        "speakers",
    ):
        raise ValueError("Invalid task/language")
    if type(request.get("threads")) is not int or not 1 <= request["threads"] <= 16:
        raise ValueError("Invalid thread count")
    models, wav = Path(request["models"]).resolve(), Path(request["audio"]).resolve()
    progress("校验本地语音模型")
    verify_models(models, request["language"], request["task"])
    with wave.open(str(wav), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
            1,
            2,
            16000,
        ):
            raise ValueError("Expected mono PCM16 16 kHz WAV")
        duration = source.getnframes() / 16000
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Empty audio")
    if request["task"] == "speakers":
        result = resolve_speakers(
            wav,
            models,
            request["segments"],
            request["threads"],
            request.get("speakers"),
            request.get("expected_speakers"),
        )
    else:
        result = transcribe(request, models, wav, duration)
    result.update(duration_seconds=duration, source_sha256=digest(wav))
    output = Path(request["output"])
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), "utf-8")
    temporary.replace(output)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.request.read_text("utf-8")))
