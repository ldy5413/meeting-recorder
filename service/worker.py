import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import hashlib
import threading
import traceback

from service.chunking import windows, merge
from service.adaptive import transcribe_window
from service.speakers import resolve_speakers


def process(job_id: str, data_dir: Path):
    directory = data_dir / job_id
    db = sqlite3.connect(data_dir / "jobs.sqlite")
    job = json.loads(
        db.execute("SELECT data FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
    )
    context_info = job.get("context_info", "")

    def update(**fields):
        current = json.loads(
            db.execute("SELECT data FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
        )
        if current["status"] == "cancelled":
            raise InterruptedError("Cancelled")
        current.update(fields)
        db.execute("UPDATE jobs SET data=? WHERE id=?", (json.dumps(current), job_id))
        db.commit()

    started = time.monotonic()
    peak_rss = [0]
    monitoring = threading.Event()

    def sample_memory():
        import psutil

        current = psutil.Process()
        while not monitoring.wait(0.5):
            peak_rss[0] = max(peak_rss[0], current.memory_info().rss)

    monitor = threading.Thread(target=sample_memory, daemon=True)
    monitor.start()
    try:
        ffmpeg = os.getenv("FFMPEG", "ffmpeg")
        ffprobe = os.getenv("FFPROBE", "ffprobe")
        probe = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(directory / "audio"),
            ],
            capture_output=True,
            check=True,
            text=True,
            timeout=120,
        )
        duration = float(json.loads(probe.stdout)["format"]["duration"])
        if job.get("task") == "speakers":
            segments = job["input_segments"]
            if any(s["end"] > duration + 2 for s in segments):
                raise ValueError("转录时间戳超出音频长度")
            result = resolve_speakers(
                directory / "audio",
                segments,
                directory,
                lambda step: update(step=step),
                job.get("speaker_names"),
                **(
                    {"expected_speakers": job["expected_speakers"]}
                    if job.get("expected_speakers") is not None
                    else {}
                ),
            )
            update(
                status="complete",
                step="complete",
                error=None,
                **result,
                metrics={"elapsed_seconds": time.monotonic() - started},
            )
            return
        chunk_seconds = float(os.getenv("VIBEVOICE_CHUNK_SECONDS", "2700"))
        overlap_seconds = float(os.getenv("VIBEVOICE_OVERLAP_SECONDS", "20"))
        chunks = list(windows(duration, chunk_seconds, overlap_seconds))
        configuration = {
            "context_info": context_info,
            "model": os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-ASR"),
            "revision": os.getenv("VIBEVOICE_REVISION"),
            "quantization": os.getenv("VIBEVOICE_QUANTIZATION", "none"),
            "attention": os.getenv("VIBEVOICE_ATTENTION", "sdpa"),
            "chunk_seconds": chunk_seconds,
            "overlap_seconds": overlap_seconds,
            "adapter_version": 3,
            "last_token_logits": True,
            "encoder_segment_seconds": float(
                os.getenv("VIBEVOICE_ENCODER_SEGMENT_SECONDS", "20")
            ),
            "max_tokens": int(os.getenv("VIBEVOICE_MAX_TOKENS", "32768")),
        }
        cache_key = hashlib.sha256(
            json.dumps(configuration, sort_keys=True).encode()
        ).hexdigest()[:16]
        update(
            configuration=configuration, total_chunks=len(chunks), completed_chunks=0
        )
        from service.adapter import VibeVoice

        backend = VibeVoice()
        all_segments, raw_chunks = [], []
        cached_windows = 0

        def infer(offset, length):
            wav = directory / "chunk.wav"
            subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-y",
                    "-v",
                    "error",
                    "-ss",
                    str(offset),
                    "-i",
                    str(directory / "audio"),
                    "-t",
                    str(length),
                    "-ac",
                    "1",
                    "-ar",
                    "24000",
                    str(wav),
                ],
                capture_output=True,
                check=True,
                timeout=600,
            )
            return backend.transcribe(wav, context_info=context_info)

        for i, (offset, length) in enumerate(chunks):
            update(step=f"chunk {i + 1}/{len(chunks)}")
            cached_windows += int((directory / f"chunk-{cache_key}-{i}.json").exists())
            chunk = transcribe_window(
                directory,
                cache_key,
                i,
                offset,
                length,
                job_id,
                infer,
                lambda start, seconds: update(
                    step=f"chunk {i + 1}/{len(chunks)} ({start:.0f}s + {seconds:.0f}s)"
                ),
            )
            all_segments = merge(all_segments, chunk["segments"])
            raw_chunks.append(chunk["raw"])
            update(completed_chunks=i + 1, elapsed_seconds=time.monotonic() - started)
            print(
                f"Completed chunk {i + 1}/{len(chunks)}; {len(all_segments)} segments; elapsed {time.monotonic() - started:.1f}s",
                flush=True,
            )
        metrics = {
            "duration_seconds": duration,
            "elapsed_seconds": time.monotonic() - started,
            "model": os.getenv("VIBEVOICE_MODEL", "microsoft/VibeVoice-ASR"),
            "device": backend.device,
            "chunk_seconds": float(os.getenv("VIBEVOICE_CHUNK_SECONDS", "2700")),
            "peak_host_rss_bytes": peak_rss[0],
            "configuration": configuration,
            "generation_seconds_limit": float(
                os.getenv("VIBEVOICE_GENERATION_SECONDS", "600")
            ),
            "offload_speech": backend.offload_speech,
            "compact_streaming_cache": True,
            "cached_windows": cached_windows,
            "incomplete_windows": len(
                list(directory.glob(f"chunk-{cache_key}-*-incomplete.json"))
            ),
            "peak_gpu_bytes": backend.torch.cuda.max_memory_allocated()
            if backend.torch.cuda.is_available()
            else None,
        }
        # CPU speaker embeddings run after ASR and also reconcile adaptive subwindows.
        result = resolve_speakers(
            directory / "audio",
            all_segments,
            directory,
            lambda step: update(step=step),
        )
        metrics["elapsed_seconds"] = time.monotonic() - started
        update(
            status="complete",
            step="complete",
            **result,
            raw=raw_chunks,
            metrics=metrics,
            error=None,
        )
    except InterruptedError:
        pass
    except Exception as exc:
        traceback.print_exc()
        update(status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        monitoring.set()
        monitor.join(timeout=1)
        db.close()


if __name__ == "__main__":
    process(sys.argv[1], Path(sys.argv[2]))
