"""Compare CPU speaker embeddings on frozen local diarization boundaries.

This isolates embedding/reconciliation changes; it cannot measure DER without
human speaker annotations. Original recordings and application data are read-only.
"""

import argparse
import importlib.metadata
import json
import math
from pathlib import Path
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import DEFAULT_MODELS, digest, verify  # noqa: E402
from service.speakers import reconcile_turns, turn_samples, unit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / ".local/lightweight-asr/candidates"
CAMPPLUS_FILE = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
CAMPPLUS_SHA256 = "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2"


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(path)


def interval_seconds(intervals):
    end, total = 0.0, 0.0
    for a, b in sorted(intervals):
        total += max(0, b - max(a, end))
        end = max(end, b)
    return total


def diagnostics(original, turns):
    unresolved = [s for s in turns if s["speaker"].startswith("unresolved-")]
    collapsed = []
    for i, left in enumerate(turns):
        for j in range(i + 1, len(turns)):
            right = turns[j]
            if right["start"] >= left["end"]:
                break
            if (
                left["speaker"] == right["speaker"]
                and not left["speaker"].startswith("unresolved-")
                and original[i]["speaker"] != original[j]["speaker"]
            ):
                collapsed.append(
                    (max(left["start"], right["start"]), min(left["end"], right["end"]))
                )
    return {
        "resolved_groups": len(
            {s["speaker"] for s in turns if not s["speaker"].startswith("unresolved-")}
        ),
        "unresolved_turns": len(unresolved),
        "unresolved_speaker_seconds": sum(s["end"] - s["start"] for s in unresolved),
        "total_speaker_seconds": sum(s["end"] - s["start"] for s in turns),
        "collapsed_input_overlap_pairs": len(collapsed),
        "collapsed_input_overlap_seconds": interval_seconds(collapsed),
        "warning": "Input boundaries/labels are machine-generated. Group count, coverage and overlap diagnostics are not accuracy or DER.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument(
        "--model", choices=["campplus", "wespeaker"], default="campplus"
    )
    parser.add_argument(
        "--thresholds", type=float, nargs="+", default=[0.55, 0.65, 0.75]
    )
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.threads < 1 or any(
        not math.isfinite(t) or not 0 < t <= 1 for t in args.thresholds
    ):
        parser.error("Invalid threads or thresholds")
    started = time.monotonic()
    source = json.loads(args.report.read_text("utf-8"))
    if source.get("status") != "complete" or source.get("synthetic_repeat"):
        raise ValueError("Use a completed, real-recording report")
    audio_hash = digest(args.audio)
    if source["decoded_sha256"] != audio_hash:
        raise ValueError("Decoded audio hash differs from report")
    model = (
        ROOT / CAMPPLUS_FILE
        if args.model == "campplus"
        else DEFAULT_MODELS / "wespeaker.onnx"
    )
    model_hash = digest(model)
    if args.model == "campplus":
        if model_hash != CAMPPLUS_SHA256:
            raise ValueError("CAM++ model hash mismatch")
    else:
        verify(DEFAULT_MODELS)
    with wave.open(str(args.audio), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (
            1,
            2,
            16000,
        ):
            raise ValueError("Expected mono 16 kHz PCM16")
        duration = wav.getnframes() / 16000
    segments = [
        {**s, "id": f"turn-{i}", "text": "speech"}
        for i, s in enumerate(
            sorted(source["speaker_turns"], key=lambda s: (s["start"], s["end"]))
        )
    ]
    for s in segments:
        if not (
            math.isfinite(s["start"])
            and math.isfinite(s["end"])
            and 0 <= s["start"] < s["end"] <= duration + 0.1
        ):
            raise ValueError("Invalid input turn")
    ranges = turn_samples(segments)
    fingerprint = {
        "version": 1,
        "report_sha256": digest(args.report),
        "audio_sha256": audio_hash,
        "model_sha256": model_hash,
        "runtime": importlib.metadata.version("sherpa-onnx"),
        "threads": args.threads,
        "ranges": ranges,
        "reconciliation_sha256": digest(
            Path(__file__).resolve().parent.parent / "service/speakers.py"
        ),
    }
    cache = args.output / "embeddings.json"
    if args.resume:
        stored = json.loads(cache.read_text("utf-8"))
        if stored["fingerprint"] != fingerprint:
            raise ValueError("Resume fingerprint differs")
        vectors = stored["vectors"]
        extraction_seconds = stored.get("extraction_seconds", 0)
    else:
        args.output.mkdir(parents=True, exist_ok=False)
        vectors, extraction_seconds = {}, 0.0
    import numpy as np
    import psutil
    import sherpa_onnx as sherpa

    result = {
        "status": "running",
        "model": args.model,
        "fingerprint": fingerprint,
        "source_sha256": source["source_sha256"],
        "duration_seconds": duration,
        "original_groups": len({s["speaker"] for s in segments}),
        "turns": len(segments),
        "sampled_turns": len(ranges),
        "comparisons": [],
        "accuracy_status": "Not evaluated: no verified human speaker annotations",
    }
    save(args.output / "report.json", result)
    save(
        cache,
        {
            "fingerprint": fingerprint,
            "vectors": vectors,
            "extraction_seconds": extraction_seconds,
        },
    )
    try:
        pending = [sid for sid in ranges if sid not in vectors]
        if pending:
            extractor = sherpa.SpeakerEmbeddingExtractor(
                sherpa.SpeakerEmbeddingExtractorConfig(
                    model=str(model),
                    provider="cpu",
                    num_threads=args.threads,
                )
            )
            with wave.open(str(args.audio), "rb") as wav:
                for i, sid in enumerate(pending):
                    sample = ranges[sid]
                    wav.setpos(int(sample["start"] * 16000))
                    audio = (
                        np.frombuffer(
                            wav.readframes(
                                int((sample["end"] - sample["start"]) * 16000)
                            ),
                            dtype="<i2",
                        ).astype(np.float32)
                        / 32768
                    )
                    start = time.monotonic()
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
                    extraction_seconds += time.monotonic() - start
                    vectors[sid] = vector
                    if (i + 1) % 25 == 0 or i + 1 == len(pending):
                        save(
                            cache,
                            {
                                "fingerprint": fingerprint,
                                "vectors": vectors,
                                "extraction_seconds": extraction_seconds,
                            },
                        )
                        print(
                            f"{args.model} embeddings {i + 1}/{len(pending)}",
                            flush=True,
                        )
            del extractor
        for threshold in args.thresholds:
            start = time.monotonic()
            reconciled = reconcile_turns(segments, vectors, ranges, threshold=threshold)
            resolution = reconciled["speaker_resolution"]
            # The shared reconciliation helper describes its production encoder.
            # Replace that metadata with the encoder actually used in this run.
            resolution.update(model=model.name, model_sha256=model_hash)
            turns = [
                {k: s[k] for k in ("id", "start", "end", "speaker")}
                for s in reconciled["segments"]
            ]
            comparison = {
                "threshold": threshold,
                "seconds": time.monotonic() - start,
                "diagnostics": diagnostics(segments, turns),
                "speaker_turns": turns,
                "speaker_resolution": resolution,
            }
            result["comparisons"].append(comparison)
            print(
                json.dumps({"threshold": threshold, **comparison["diagnostics"]}),
                flush=True,
            )
            save(args.output / "report.json", result)
        result.update(status="complete", extraction_seconds=extraction_seconds)
    except BaseException as exc:
        result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        memory = psutil.Process().memory_info()
        result.update(
            elapsed_this_run_seconds=time.monotonic() - started,
            peak_process_rss_bytes=getattr(memory, "peak_wset", memory.rss),
            torch_imported="torch" in sys.modules,
        )
        save(args.output / "report.json", result)


if __name__ == "__main__":
    main()
