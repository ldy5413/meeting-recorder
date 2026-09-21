"""Compare local ASR on frozen installed-recording excerpts, without fake gold.

Results persist after each sample. No audio/text is sent to a remote service.
Text disagreement with an existing transcript is NOT an accuracy measurement.
"""

import argparse
import importlib.metadata
import json
from pathlib import Path
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import DEFAULT_MODELS, digest, verify  # noqa: E402
from service.lightweight_scoring import distance, normalize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / ".local/lightweight-asr/candidates"


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument(
        "--engine", choices=["sensevoice", "qwen3", "funasr", "firered2"], required=True
    )
    parser.add_argument(
        "--split",
        choices=["development", "holdout", "smoke", "all"],
        default="development",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument(
        "--hotwords",
        action="store_true",
        help="Use only pre-existing meeting keywords, never baseline transcript text",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.threads < 1 or (args.limit is not None and args.limit < 1):
        parser.error("Invalid threads/limit")
    if args.hotwords and args.engine not in ("qwen3", "funasr"):
        parser.error("This engine path does not support context hotwords")
    corpus = json.loads(args.corpus.read_text("utf-8"))
    meetings = {m["id"]: m for m in corpus["meetings"]}
    samples = [
        s for s in corpus["samples"] if args.split == "all" or s["split"] == args.split
    ]
    if args.limit:
        samples = samples[: args.limit]
    if not samples:
        parser.error("No matching corpus samples")
    # Bind resumed outputs to their model files as well as their corpus/runtime.
    # Validate even on a no-op resume; old results must never bless changed files.
    model_fingerprint = {}
    if args.engine == "sensevoice":
        verify(DEFAULT_MODELS)
        for name in ("sensevoice.int8.onnx", "tokens.txt"):
            model_fingerprint[name] = digest(DEFAULT_MODELS / name)
    else:
        manifest_path = ROOT / f"{args.engine}-manifest.json"
        manifest = json.loads(manifest_path.read_text("utf-8"))
        for relative, info in manifest["files"].items():
            if relative.endswith((".onnx", "/tokens.txt")) or any(
                part in relative for part in ("/tokenizer/", "/Qwen3-0.6B/")
            ):
                path = (ROOT / relative).resolve()
                if (
                    not path.is_relative_to(ROOT.resolve())
                    or digest(path) != info["sha256"]
                ):
                    raise ValueError("Candidate model path/hash mismatch")
                model_fingerprint[relative] = info["sha256"]
        if not model_fingerprint:
            raise ValueError("Empty candidate manifest")
    configuration = {
        "engine": args.engine,
        "threads": args.threads,
        "hotwords": args.hotwords,
        "sample_ids": [s["id"] for s in samples],
        "corpus_sha256": digest(args.corpus),
        "runtime": importlib.metadata.version("sherpa-onnx"),
        "provider": "cpu",
        "version": 2,
        "model_fingerprint": model_fingerprint,
    }
    results = []
    report_path = args.output / "report.json"
    previous = {}
    if args.resume:
        previous = json.loads(report_path.read_text("utf-8"))
        if previous["configuration"] != configuration:
            raise ValueError("Resume configuration or corpus differs")
        results = previous["results"]
    else:
        args.output.mkdir(parents=True, exist_ok=False)
    import numpy as np
    import psutil
    import sherpa_onnx as sherpa

    process = psutil.Process()
    report = {
        **previous,
        "configuration": configuration,
        "status": "running",
        "results": results,
        "accuracy_status": "pending verified human references; machine disagreement is not CER",
    }
    atomic_json(report_path, report)
    loaded_hotwords = None
    recognizer = None
    model_load_seconds = previous.get("model_load_seconds", 0.0)
    completed = {r["sample_id"] for r in results}
    if len(completed) != len(results) or completed - set(configuration["sample_ids"]):
        raise ValueError("Invalid resumed sample IDs")
    prior_results = {r["sample_id"]: r for r in results}
    try:
        for sample in samples:
            wav = (args.corpus.parent / sample["audio"]).resolve()
            if (
                not wav.is_relative_to(args.corpus.parent.resolve())
                or digest(wav) != sample["decoded_sha256"]
            ):
                raise ValueError("Corpus audio path/hash mismatch")
            if sample["id"] in completed:
                if (
                    prior_results[sample["id"]]["decoded_sha256"]
                    != sample["decoded_sha256"]
                ):
                    raise ValueError("Resumed result audio hash mismatch")
                continue
            keywords = (
                meetings[sample["meeting_id"]].get("context", {}).get("keywords", "")
                if args.hotwords
                else ""
            )
            if isinstance(keywords, list):
                keywords = ", ".join(str(s) for s in keywords)
            keywords = str(keywords or "")[:1024]
            if recognizer is None or keywords != loaded_hotwords:
                started = time.monotonic()
                recognizer = None
                if args.engine == "sensevoice":
                    verify(DEFAULT_MODELS)
                    recognizer = sherpa.OfflineRecognizer.from_sense_voice(
                        model=str(DEFAULT_MODELS / "sensevoice.int8.onnx"),
                        tokens=str(DEFAULT_MODELS / "tokens.txt"),
                        num_threads=args.threads,
                        provider="cpu",
                        language="auto",
                        use_itn=True,
                    )
                else:
                    if args.engine == "qwen3":
                        directory = ROOT / "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"
                        recognizer = sherpa.OfflineRecognizer.from_qwen3_asr(
                            conv_frontend=str(directory / "conv_frontend.onnx"),
                            encoder=str(directory / "encoder.int8.onnx"),
                            decoder=str(directory / "decoder.int8.onnx"),
                            tokenizer=str(directory / "tokenizer"),
                            num_threads=args.threads,
                            provider="cpu",
                            max_total_len=1024,
                            max_new_tokens=512,
                            hotwords=keywords,
                        )
                    elif args.engine == "funasr":
                        directory = ROOT / "sherpa-onnx-funasr-nano-int8-2025-12-30"
                        recognizer = sherpa.OfflineRecognizer.from_funasr_nano(
                            encoder_adaptor=str(
                                directory / "encoder_adaptor.int8.onnx"
                            ),
                            llm=str(directory / "llm.int8.onnx"),
                            embedding=str(directory / "embedding.int8.onnx"),
                            tokenizer=str(directory / "Qwen3-0.6B"),
                            num_threads=args.threads,
                            provider="cpu",
                            max_new_tokens=512,
                            itn=True,
                            hotwords=keywords,
                        )
                    else:
                        directory = (
                            ROOT / "sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26"
                        )
                        recognizer = sherpa.OfflineRecognizer.from_fire_red_asr(
                            encoder=str(directory / "encoder.int8.onnx"),
                            decoder=str(directory / "decoder.int8.onnx"),
                            tokens=str(directory / "tokens.txt"),
                            num_threads=args.threads,
                            provider="cpu",
                        )
                    report["candidate_manifest_sha256"] = digest(
                        ROOT / f"{args.engine}-manifest.json"
                    )
                model_load_seconds += time.monotonic() - started
                loaded_hotwords = keywords
            with wave.open(str(wav), "rb") as source:
                if (
                    source.getnchannels(),
                    source.getsampwidth(),
                    source.getframerate(),
                ) != (1, 2, 16000):
                    raise ValueError("Corpus must contain mono PCM16 16 kHz")
                audio = (
                    np.frombuffer(
                        source.readframes(source.getnframes()), dtype="<i2"
                    ).astype(np.float32)
                    / 32768
                )
            started = time.monotonic()
            stream = recognizer.create_stream()
            stream.accept_waveform(16000, audio)
            recognizer.decode_stream(stream)
            result = stream.result
            text = result.text
            elapsed = time.monotonic() - started
            baseline = normalize("".join(s["text"] for s in sample["baseline"]))
            hypothesis = normalize(text)
            # Baseline segments may cross clip boundaries. This is diagnostic only.
            result_data = {
                "sample_id": sample["id"],
                "split": sample["split"],
                "decoded_sha256": sample["decoded_sha256"],
                "text": text,
                "tokens": list(result.tokens),
                "timestamps": list(result.timestamps),
                "inference_seconds": elapsed,
                "duration_seconds": len(audio) / 16000,
                "hotwords": keywords,
                "characters": len(hypothesis),
                "machine_disagreement_ratio": distance(baseline, hypothesis)
                / max(1, len(baseline)),
                "comparison_warning": "Machine baseline overlaps clip edges and is not ground truth",
            }
            results.append(result_data)
            memory = process.memory_info()
            report.update(
                model_load_seconds=model_load_seconds,
                peak_process_rss_bytes=max(
                    report.get("peak_process_rss_bytes", 0),
                    getattr(memory, "peak_wset", memory.rss),
                ),
                torch_imported="torch" in sys.modules,
            )
            atomic_json(report_path, report)
            print(
                f"{args.engine}: {len(results)}/{len(samples)}, {elapsed:.2f}s, {len(hypothesis)} characters",
                flush=True,
            )
        report["status"] = "complete"
    except BaseException as error:
        report.update(status="failed", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        atomic_json(report_path, report)


if __name__ == "__main__":
    main()
