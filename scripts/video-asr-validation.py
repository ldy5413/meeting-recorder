"""Explicit local-service transcription of root video fixtures, with resumable results."""

import json
import hashlib
from pathlib import Path
import sys
import time

import requests


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    root = Path(__file__).resolve().parent.parent
    output = root / ".local" / "video-validation"
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "asr-jobs.json"
    jobs = json.loads(manifest.read_text()) if manifest.exists() else []
    for index, source in enumerate(sorted(root.glob("*.mp4"), key=lambda p: p.name)):
        previous_job = next((job for job in jobs if job["source"] == str(source)), None)
        if previous_job:
            status = requests.get(
                f"http://127.0.0.1:8765/jobs/{previous_job['remoteId']}", timeout=30
            )
            status.raise_for_status()
            if (
                status.json()["status"] not in ("failed", "cancelled")
                or "--retry" not in sys.argv
            ):
                continue
        with source.open("rb") as media:
            digest = hashlib.file_digest(media, "sha256").hexdigest()
        key = previous_job.get("key") if previous_job else None
        if previous_job and not key:
            # Compatibility with the first local validation run's indexed keys.
            key = f"video-stage1-full-{jobs.index(previous_job)}"
        key = key or f"video-stage1-full-{digest[:32]}"
        with source.open("rb") as media:
            response = requests.post(
                "http://127.0.0.1:8765/jobs",
                files={"audio": (source.name, media, "video/mp4")},
                headers={"Idempotency-Key": key},
                timeout=180,
            )
        response.raise_for_status()
        entry = {
            "source": str(source),
            "remoteId": response.json()["id"],
            "key": key,
            "sha256": digest,
        }
        if previous_job:
            jobs[jobs.index(previous_job)] = entry
        else:
            jobs.append(entry)
        manifest.write_text(
            json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"Submitted video {index + 1}: {response.json()['id']}", flush=True)
    previous = {}
    while True:
        terminal = True
        for index, job in enumerate(jobs):
            response = requests.get(
                f"http://127.0.0.1:8765/jobs/{job['remoteId']}", timeout=30
            )
            response.raise_for_status()
            result = response.json()
            progress = (
                result["status"],
                result.get("step"),
                result.get("completed_chunks"),
            )
            if previous.get(index) != progress:
                print(f"Video {index + 1}: {progress}", flush=True)
                previous[index] = progress
            result_file = output / f"asr-{index + 1}.json"
            temporary = result_file.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(result, ensure_ascii=False), encoding="utf-8"
            )
            temporary.replace(result_file)
            terminal &= result["status"] in ("complete", "failed", "cancelled")
        if terminal:
            break
        time.sleep(20)


if __name__ == "__main__":
    main()
