"""Repair speaker labels in an existing transcript without running ASR again."""

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.app import SpeakerSegment
from service.speakers import resolve_speakers
from pydantic import TypeAdapter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-speakers", type=int, choices=range(1, 51))
    args = parser.parse_args()
    if args.output.resolve() in (args.transcript.resolve(), args.audio.resolve()):
        parser.error("Output must be separate from the original transcript and audio")
    source = json.loads(args.transcript.read_text("utf-8"))
    segments = source if isinstance(source, list) else source["segments"]
    segments = [
        s.model_dump(mode="json")
        for s in TypeAdapter(list[SpeakerSegment]).validate_python(segments)
    ]
    names = source.get("speakers", {}) if isinstance(source, dict) else {}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = resolve_speakers(
        args.audio,
        segments,
        args.output.parent,
        lambda s: print(s, flush=True),
        names,
        expected_speakers=args.expected_speakers,
    )
    result["speakers"] = {}
    for old, new in zip(segments, result["segments"]):
        if names.get(old["speaker"]) and new["speaker"] != "non-speech":
            result["speakers"][new["speaker"]] = names[old["speaker"]]
    result["elapsed_seconds"] = time.monotonic() - started
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    print(
        json.dumps(
            {
                k: v
                for k, v in result["speaker_resolution"].items()
                if k not in ("mapping", "merges", "segment_mapping", "matches")
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
