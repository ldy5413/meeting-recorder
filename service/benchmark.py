"""Run real audio through the ASR API; records latency and worker resource metrics.

No accuracy scores are fabricated: use --reference with manually normalized text.
"""

import argparse
import json
import os
from pathlib import Path
import time
import httpx


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        next_row = [i]
        for j, right in enumerate(b, 1):
            next_row.append(
                min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (left != right))
            )
        row = next_row
    return row[-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    token = os.getenv("MEETING_ASR_TOKEN", "")
    started = time.monotonic()
    with httpx.Client(
        headers={"Authorization": f"Bearer {token}"} if token else {}, timeout=180
    ) as client:
        with args.audio.open("rb") as audio:
            response = client.post(
                f"{args.url.rstrip('/')}/jobs",
                files={"audio": (args.audio.name, audio)},
            )
        response.raise_for_status()
        job_id = response.json()["id"]
        try:
            while True:
                response = client.get(f"{args.url.rstrip('/')}/jobs/{job_id}")
                response.raise_for_status()
                job = response.json()
                print(job["status"], job.get("step"), flush=True)
                if job["status"] in ("complete", "failed", "cancelled"):
                    break
                time.sleep(3)
        except KeyboardInterrupt:
            client.delete(f"{args.url.rstrip('/')}/jobs/{job_id}")
            raise
    report = {
        "source": args.audio.name,
        "wall_seconds": time.monotonic() - started,
        "job": job,
    }
    if args.reference and job["status"] == "complete":
        reference = "".join(args.reference.read_text("utf-8").split())
        hypothesis = "".join("".join(s["text"].split()) for s in job["segments"])
        report["character_error_rate"] = edit_distance(reference, hypothesis) / max(
            1, len(reference)
        )
        report["normalization"] = "whitespace removed; punctuation and case retained"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    if job["status"] != "complete":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
