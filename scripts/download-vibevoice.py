"""Download only the pinned official model weights/config into the local deployment."""

import argparse
from pathlib import Path
import sys
import os

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

ROOT = Path(__file__).resolve().parent.parent
bootstrap = ROOT / ".local" / "downloader"
if bootstrap.exists():
    sys.path.insert(0, str(bootstrap))
from huggingface_hub import snapshot_download  # noqa: E402 — load the optional bootstrap first

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--revision", default="d0c9efdb8d614685062c04425d91e01b6f37d944"
    )
    args = parser.parse_args()
    result = snapshot_download(
        "microsoft/VibeVoice-ASR",
        revision=args.revision,
        local_dir=ROOT / ".local" / "models" / "VibeVoice-ASR",
        allow_patterns=["*.json", "*.safetensors"],
        max_workers=4,
    )
    print(result, flush=True)
    tokenizer = snapshot_download(
        "Qwen/Qwen2.5-7B",
        revision="d149729398750b98c0af14eb82c78cfe92750796",
        cache_dir=ROOT / ".local/hf-cache/hub",
        allow_patterns=[
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
        ],
        max_workers=4,
    )
    print(tokenizer, flush=True)
