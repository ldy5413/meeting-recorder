"""Download the pinned official WeSpeaker ONNX model; never sends meeting data."""

import os
from pathlib import Path
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.speakers import (
    MODEL_FILE,
    MODEL_REPO,
    MODEL_REVISION,
    MODEL_SHA256,
    digest,
)


def main():
    path = Path(
        os.getenv(
            "MEETING_SPEAKER_MODEL",
            str(Path(__file__).resolve().parent.parent / ".local/models" / MODEL_FILE),
        )
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and digest(path) == MODEL_SHA256:
        print(f"Verified: {path}")
        return
    temporary = path.with_suffix(".download")
    url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{MODEL_FILE}"
    with (
        urllib.request.urlopen(url, timeout=120) as source,
        temporary.open("wb") as target,
    ):
        while block := source.read(1024 * 1024):
            target.write(block)
    if digest(temporary) != MODEL_SHA256:
        raise RuntimeError("Speaker model SHA-256 mismatch")
    temporary.replace(path)
    print(f"Downloaded and verified: {path}")


if __name__ == "__main__":
    main()
