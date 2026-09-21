"""Score manually reviewed excerpts exported from the local review page."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_scoring import score  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = score(
        json.loads(args.report.read_text("utf-8")),
        json.loads(args.reference.read_text("utf-8")),
    )
    with args.output.open("x", encoding="utf-8") as target:
        target.write(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Scored {len(result['samples'])} reviewed excerpts; output saved locally")


if __name__ == "__main__":
    main()
