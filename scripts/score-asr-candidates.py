"""Score a candidate run against explicitly reviewed local corpus excerpts."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import digest  # noqa: E402
from service.lightweight_scoring import score_corpus  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    corpus = json.loads(args.corpus.read_text("utf-8"))
    for sample in corpus["samples"]:
        audio = (args.corpus.parent / sample["audio"]).resolve()
        if (
            not audio.is_relative_to(args.corpus.parent.resolve())
            or digest(audio) != sample["decoded_sha256"]
        ):
            raise ValueError("Corpus audio path/hash mismatch")
    result = score_corpus(
        corpus,
        json.loads(args.report.read_text("utf-8")),
        json.loads(args.reference.read_text("utf-8")),
        digest(args.corpus),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as target:
        json.dump(result, target, ensure_ascii=False, indent=2)
    print(json.dumps(result["splits"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
