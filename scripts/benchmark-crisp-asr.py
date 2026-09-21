"""Run pinned Qwen3-ASR 1.7B GGUF with the native Windows CPU runtime.

Exploratory comparison after reading the original holdout scores. No gold text,
per-sample vocabulary, remote inference or automatic auxiliary model selection.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import digest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / ".local/lightweight-asr/candidates"
MODEL_SHA = "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4"


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--language", choices=["auto", "zh"], default="auto")
    parser.add_argument(
        "--split", choices=["all", "development", "holdout", "smoke"], default="all"
    )
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("threads must be positive")
    import psutil

    model = ROOT / "qwen3-asr-1.7b-q4_k.gguf"
    if digest(model) != MODEL_SHA:
        raise ValueError("Model fingerprint mismatch")
    runtime = ROOT / "crisp_cpu/crispasr-windows-x86_64-cpu"
    manifest = json.loads((ROOT / "crisp_cpu-manifest.json").read_text("utf-8"))
    for relative, info in manifest["files"].items():
        path = (ROOT / relative).resolve()
        if not path.is_relative_to(ROOT.resolve()) or digest(path) != info["sha256"]:
            raise ValueError("Runtime fingerprint mismatch")
    corpus = json.loads(args.corpus.read_text("utf-8"))
    samples = [
        s for s in corpus["samples"] if args.split == "all" or s["split"] == args.split
    ]
    if not samples:
        parser.error("No matching samples")
    config = {
        "engine": "qwen3-1.7b-q4k-native" + ("-zh" if args.language == "zh" else ""),
        "hotwords": False,
        "evaluation_stage": "post-reference exploratory; original holdout already inspected",
        "corpus_sha256": digest(args.corpus),
        "sample_ids": [s["id"] for s in samples],
        "runtime": "CrispASR 0.8.34 Windows x64 CPU",
        "threads": args.threads,
        "provider": "cpu",
        "lid_backend": "off",
        "language": args.language,
        "model_sha256": MODEL_SHA,
        "runtime_manifest_sha256": digest(ROOT / "crisp_cpu-manifest.json"),
        "version": 1,
        "prompt": "",
        "chunk_seconds": 30,
    }
    path = args.output / "report.json"
    if args.resume:
        report = json.loads(path.read_text("utf-8"))
        if report["configuration"] != config:
            raise ValueError("Resume configuration differs")
    else:
        args.output.mkdir(parents=True, exist_ok=False)
        report = {
            "configuration": config,
            "results": [],
            "status": "running",
            "peak_process_rss_bytes": 0,
        }
    results = {r["sample_id"]: r for r in report["results"]}
    if len(results) != len(report["results"]) or set(results) - set(
        config["sample_ids"]
    ):
        raise ValueError("Invalid resumed results")
    env = dict(os.environ)
    system_root = os.environ["SystemRoot"]
    env["PATH"] = os.pathsep.join(
        [
            str(runtime.resolve()),
            str(Path(system_root) / "System32"),
            system_root,
        ]
    )
    env["OMP_NUM_THREADS"] = env["OPENBLAS_NUM_THREADS"] = str(args.threads)
    report.update(
        status="running",
        timing_scope="Each excerpt uses a fresh native process; elapsed includes startup/model loading",
        accuracy_status="Score against frozen human references separately; this is post-reference exploratory",
    )
    save(path, report)
    try:
        for sample in samples:
            wav = (args.corpus.parent / sample["audio"]).resolve()
            if (
                not wav.is_relative_to(args.corpus.parent.resolve())
                or digest(wav) != sample["decoded_sha256"]
            ):
                raise ValueError("Corpus audio fingerprint/path mismatch")
            if sample["id"] in results:
                if results[sample["id"]]["decoded_sha256"] != sample["decoded_sha256"]:
                    raise ValueError("Resumed output fingerprint mismatch")
                continue
            output = (args.output / sample["id"]).resolve()
            command = [
                str((runtime / "crispasr.exe").resolve()),
                "--backend",
                "qwen3",
                "-m",
                str(model.resolve()),
                "-f",
                str(wav),
                "--no-gpu",
                "--gpu-backend",
                "cpu",
                "--threads",
                str(args.threads),
                "--lid-backend",
                "off",
                "--language",
                args.language,
                "--chunk-seconds",
                "30",
                "--cache-dir",
                str((args.output / "aux-cache").resolve()),
                "--output-json",
                "--output-file",
                str(output),
            ]
            start = time.monotonic()
            peak = 0
            with (
                output.with_suffix(".stdout.txt").open("wb") as stdout,
                output.with_suffix(".stderr.txt").open("wb") as stderr,
            ):
                child = subprocess.Popen(
                    command,
                    stdout=stdout,
                    stderr=stderr,
                    env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                process = psutil.Process(child.pid)
                try:
                    while child.poll() is None:
                        try:
                            memory = process.memory_info()
                            peak = max(peak, getattr(memory, "peak_wset", memory.rss))
                        except psutil.NoSuchProcess:
                            pass
                        if time.monotonic() - start > 180:
                            raise TimeoutError(
                                "Native short-clip inference exceeded 180 seconds"
                            )
                        time.sleep(0.1)
                    if child.returncode != 0:
                        raise RuntimeError(
                            f"Native inference failed: exit {child.returncode}"
                        )
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=10)
            elapsed = time.monotonic() - start
            native = json.loads(output.with_suffix(".json").read_text("utf-8-sig"))
            if native.get("crispasr", {}).get("backend") != "qwen3":
                raise ValueError("Unexpected native backend")
            result = {
                "sample_id": sample["id"],
                "split": sample["split"],
                "decoded_sha256": sample["decoded_sha256"],
                "text": "".join(s["text"] for s in native["transcription"]),
                "timestamps": [],
                "tokens": [],
                "timestamp_scope": "Native segment offsets only; no verified word alignment",
                "native_segments": native["transcription"],
                "process_seconds": elapsed,
                "peak_process_rss_bytes": peak,
                "duration_seconds": sample["duration_seconds"],
            }
            report["results"].append(result)
            report["peak_process_rss_bytes"] = max(
                report["peak_process_rss_bytes"], peak
            )
            save(path, report)
            print(
                f"Qwen3 1.7B native: {len(report['results'])}/{len(samples)}, {elapsed:.2f}s",
                flush=True,
            )
        report["status"] = "complete"
    except BaseException as exc:
        report.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        save(path, report)


if __name__ == "__main__":
    main()
