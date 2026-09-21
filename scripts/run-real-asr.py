"""Run actual imported meetings through the live development app and local ASR.

Uses the private local bridge manifest; never prints its bearer token or transcript.
"""

import argparse
import json
import os
from pathlib import Path
import time
import sys
import httpx

sys.stdout.reconfigure(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("meetings", nargs="+")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
        / "MeetingRecorder-dev-browser",
    )
    parser.add_argument(
        "--output", type=Path, default=Path(".local/real-asr-report.json")
    )
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    with httpx.Client(timeout=120) as client:

        def call(request):
            # A source restart changes the ephemeral origin/token; reacquire the file.
            manifest = json.loads(
                (args.data_dir / "dev-bridge.json").read_text("utf-8")
            )
            response = client.post(
                manifest["origin"] + "/api/request",
                headers={
                    "Origin": manifest["origin"],
                    "Authorization": f"Bearer {manifest['token']}",
                },
                json=request,
            )
            response.raise_for_status()
            result = response.json()
            if not result.get("ok"):
                raise RuntimeError(result.get("error"))
            return result.get("value")

        started = time.monotonic()
        existing = call({"op": "state"})["jobs"]
        jobs = []
        for meeting_id in args.meetings:
            matching = [
                j
                for j in existing
                if j["meetingId"] == meeting_id and j["kind"] == "transcribe"
            ]
            previous = matching[-1] if matching else None
            if previous and previous["status"] in ("queued", "running", "complete"):
                jobs.append(previous)
            elif previous and args.retry:
                jobs.append(call({"op": "job.retry", "id": previous["id"]}))
            elif previous:
                jobs.append(previous)
            else:
                jobs.append(
                    call({"op": "job.start", "id": meeting_id, "kind": "transcribe"})
                )
        ids = {job["id"] for job in jobs}
        previous_display = None
        while True:
            state = call({"op": "state"})
            jobs = [job for job in state["jobs"] if job["id"] in ids]
            display = " | ".join(
                f"{job['id'][:8]} {job['status']} {job['step']}" for job in jobs
            )
            if display != previous_display:
                print(display, flush=True)
                previous_display = display
            if all(j["status"] in ("complete", "failed", "cancelled") for j in jobs):
                break
            time.sleep(10)
        results = []
        for job in jobs:
            meeting = next(m for m in state["meetings"] if m["id"] == job["meetingId"])
            result = {
                "job": job,
                "meeting_id": meeting["id"],
                "segments": len(meeting["segments"]),
                "transcript_version": meeting["version"],
            }
            if job.get("remoteId"):
                remote = client.get(
                    f"http://127.0.0.1:8765/jobs/{job['remoteId']}"
                ).json()
                result["metrics"] = remote.get("metrics")
            results.append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(
                {"wall_seconds": time.monotonic() - started, "results": results},
                ensure_ascii=False,
                indent=2,
            ),
            "utf-8",
        )
        if any(j["status"] != "complete" for j in jobs):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
