"""Read installed-app recordings into a private, deterministic evaluation corpus.

No application/database writes. Existing transcripts are machine baselines, never
human references. Meeting-level development/holdout membership is fixed at export.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import digest  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--library",
        type=Path,
        default=Path(os.environ.get("APPDATA", ".")) / "meeting-recorder/library",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location(
        "benchmark_lightweight", Path(__file__).with_name("benchmark-lightweight.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    audio_root = (args.library / "audio").resolve()
    db = sqlite3.connect(
        (args.library / "library.sqlite").resolve().as_uri() + "?mode=ro", uri=True
    )
    db.execute("BEGIN")
    meetings = sorted(
        (json.loads(r[0]) for r in db.execute("SELECT data FROM meetings")),
        key=lambda m: (m.get("created", ""), m["id"]),
    )
    long_index = 0
    corpus = {
        "format": "meeting-local-corpus-v1",
        "reference_status": "No verified human transcripts; saved application versions are machine baselines",
        "split_policy": "First three chronological meetings >=120s are development; later long meetings are holdout. Short recordings are smoke only.",
        "meetings": [],
        "samples": [],
    }
    for meeting in meetings:
        if meeting.get("deletedAt") or not meeting.get("audio"):
            continue
        audio = (audio_root / meeting["audio"]).resolve()
        if not audio.is_relative_to(audio_root) or not audio.is_file():
            raise ValueError("Missing or unsafe application audio path")
        probe = subprocess.run(
            [
                os.getenv("FFPROBE", "ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(audio),
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )
        duration = float(json.loads(probe.stdout)["format"]["duration"])
        if duration < 120:
            split = "smoke"
            ranges = [(0.0, min(duration, 30.0))]
        else:
            split = "development" if long_index < 3 else "holdout"
            long_index += 1
            ranges = [
                (round(duration * fraction, 3), 20.0) for fraction in (0.1, 0.5, 0.85)
            ]
        source_hash = digest(audio)
        metadata = {
            "id": meeting["id"],
            "title": meeting.get("title", ""),
            "audio": str(audio),
            "source_sha256": source_hash,
            "duration_seconds": duration,
            "split": split,
            "transcript_version": meeting.get("version"),
            "context": meeting.get("context", {}),
            "reference_kind": "unverified machine baseline",
        }
        corpus["meetings"].append(metadata)
        for index, (offset, length) in enumerate(ranges):
            name = f"{meeting['id']}-{index}"
            wav = args.output / f"{name}.wav"
            module.decode_audio(audio, wav, offset=offset, seconds=length)
            baseline = [
                {**s, "start": s["start"] - offset, "end": s["end"] - offset}
                for s in meeting.get("segments", [])
                if s["end"] > offset and s["start"] < offset + length
            ]
            corpus["samples"].append(
                {
                    "id": name,
                    "meeting_id": meeting["id"],
                    "split": split,
                    "audio": wav.name,
                    "source_offset_seconds": offset,
                    "duration_seconds": length,
                    "decoded_sha256": digest(wav),
                    "baseline": baseline,
                    "reference_text": None,
                    "human_reviewed": False,
                }
            )
        if digest(audio) != source_hash:
            raise ValueError("Source audio changed during export")
        print(f"Exported {meeting['id']}: {split}, {len(ranges)} excerpts", flush=True)
    db.close()
    (args.output / "corpus.json").write_text(
        json.dumps(corpus, ensure_ascii=False, indent=2), "utf-8"
    )
    print(
        f"Corpus: {len(corpus['meetings'])} recordings, {len(corpus['samples'])} excerpts",
        flush=True,
    )


if __name__ == "__main__":
    main()
