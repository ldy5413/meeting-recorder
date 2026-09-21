"""Verify all downloaded shards against the official revision's LFS SHA-256 values."""

import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REVISION = "d0c9efdb8d614685062c04425d91e01b6f37d944"
if __name__ == "__main__":
    with urllib.request.urlopen(
        f"https://huggingface.co/api/models/microsoft/VibeVoice-ASR/revision/{REVISION}?blobs=true",
        timeout=30,
    ) as response:
        manifest = json.load(response)
    checks = []
    for item in manifest["siblings"]:
        if not item["rfilename"].endswith(".safetensors"):
            continue
        path = ROOT / ".local/models/VibeVoice-ASR" / item["rfilename"]
        with path.open("rb") as data:
            actual = hashlib.file_digest(data, "sha256").hexdigest()
        if actual != item["lfs"]["sha256"]:
            raise ValueError(f"Checksum mismatch: {path.name}")
        checks.append(
            {"name": path.name, "bytes": path.stat().st_size, "sha256": actual}
        )
        print(f"{path.name}: SHA-256 verified", flush=True)
    (ROOT / ".local/model-verification.json").write_text(
        json.dumps(
            {"model": manifest["id"], "revision": REVISION, "files": checks}, indent=2
        ),
        "utf-8",
    )
