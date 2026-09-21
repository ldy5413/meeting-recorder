"""Verify actual ASR identity/timestamp integrity without printing meeting text."""

import argparse
import hashlib
import json
from pathlib import Path
import httpx


def digest(path):
    with path.open("rb") as data:
        return hashlib.file_digest(data, "sha256").hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sources",
        type=Path,
        required=True,
        help="JSON object mapping meeting IDs to original audio paths",
    )
    args = parser.parse_args()
    sources = json.loads(args.sources.read_text("utf-8"))
    report = json.loads(Path(".local/real-asr-report.json").read_text("utf-8"))
    results = []
    for item in report["results"]:
        job = item["job"]
        assert job["status"] == "complete", "ASR is not complete"
        remote = httpx.get(
            f"http://127.0.0.1:8765/jobs/{job['remoteId']}", timeout=30
        ).json()
        segments = remote["segments"]
        duration = remote["metrics"]["duration_seconds"]
        assert len({s["id"] for s in segments}) == len(segments)
        assert all(
            0 <= s["start"] <= s["end"] <= duration and s["text"].strip()
            for s in segments
        )
        assert segments == sorted(
            segments, key=lambda s: (s["start"], s["end"], s["id"])
        )
        source = Path(sources[item["meeting_id"]])
        assert digest(source) == digest(
            Path(".local/asr-data") / job["remoteId"] / "audio"
        ), "Source and ASR audio differ"
        results.append(
            {
                "meeting_id": item["meeting_id"],
                "segments": len(segments),
                "speaker_labels": len({s["speaker"] for s in segments}),
                "timestamps_valid": True,
                "ids_unique": True,
                "source_audio_matches": True,
                "metrics": remote["metrics"],
            }
        )
    output = {
        "monitor_wall_seconds": report["wall_seconds"],
        "results": results,
        "note": "Integrity checks are not transcript accuracy measurements; resumed elapsed times exclude earlier attempts.",
    }
    Path(".local/real-asr-integrity.json").write_text(
        json.dumps(output, indent=2), "utf-8"
    )
    print(json.dumps(output, indent=2))
