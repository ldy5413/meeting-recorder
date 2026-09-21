"""Download pinned CPU candidates, independently of the default evaluation models."""

import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent / ".local/lightweight-asr/candidates"
CANDIDATES = {
    "crisp_cpu": {
        "file": "crispasr-windows-x86_64-cpu.zip",
        "url": "https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.34/crispasr-windows-x86_64-cpu.zip",
        "bytes": 8461557,
        "sha256": "2df3b287e55529513939c97477b8a5d528badf9fd3af0cf7c36d602bd52c8908",
    },
    "qwen3_17b_crisp": {
        "file": "qwen3-asr-1.7b-q4_k.gguf",
        "url": "https://huggingface.co/cstr/qwen3-asr-1.7b-GGUF/resolve/674df5d44b50a63e7102a18895ed20e3f91de301/qwen3-asr-1.7b-q4_k.gguf",
        "bytes": 1490915200,
        "sha256": "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4",
    },
    "firered2": {
        "file": "sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2",
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2",
        "bytes": 838589068,
        "sha256": "43015b3f1643a5688b4821e8ed323473d38b798c4ec291471fe00df1bcfc4f1c",
    },
    "funasr": {
        "file": "sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2",
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2",
        "bytes": 841730611,
        "sha256": "eb43d7ccc2e86b243f6a03b7df361033dda66db9523d1a92bf6aca2b50c9476b",
    },
    "qwen3": {
        "file": "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2",
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2",
        "bytes": 878702423,
        "sha256": "393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96",
    },
    "campplus": {
        "file": "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        "bytes": 28281164,
        "sha256": "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    },
}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidates", nargs="+", choices=sorted(CANDIDATES))
    parser.add_argument("--output", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name in args.candidates:
        entry = CANDIDATES[name]
        target = root / entry["file"]
        if not target.is_file() or digest(target) != entry["sha256"]:
            temporary = target.with_suffix(target.suffix + ".download")
            print(f"Downloading {name}: {entry['bytes']} bytes", flush=True)
            with (
                urllib.request.urlopen(entry["url"], timeout=120) as source,
                temporary.open("wb") as out,
            ):
                done = 0
                milestone = 0
                while block := source.read(1024 * 1024):
                    out.write(block)
                    done += len(block)
                    percent = int(done * 100 / entry["bytes"])
                    if percent // 10 > milestone:
                        milestone = percent // 10
                        print(f"{name}: {percent}%", flush=True)
            if (
                temporary.stat().st_size != entry["bytes"]
                or digest(temporary) != entry["sha256"]
            ):
                raise ValueError(f"Download verification failed: {name}")
            temporary.replace(target)
        if target.stat().st_size != entry["bytes"]:
            raise ValueError(f"Unexpected model size: {name}")
        files = {
            target.name: {"bytes": target.stat().st_size, "sha256": digest(target)}
        }
        if target.name.endswith(".tar.bz2"):
            print(f"Extracting {name}", flush=True)
            with tarfile.open(target) as archive:
                for member in archive.getmembers():
                    if not (root / member.name).resolve().is_relative_to(root):
                        raise ValueError("Unsafe candidate archive path")
                archive.extractall(root, filter="data")
                for member in archive.getmembers():
                    if member.isfile():
                        path = root / member.name
                        files[member.name] = {
                            "bytes": path.stat().st_size,
                            "sha256": digest(path),
                        }
        if target.suffix == ".zip":
            directory = root / name
            directory.mkdir(exist_ok=True)
            with zipfile.ZipFile(target) as archive:
                for member in archive.infolist():
                    path = (directory / member.filename).resolve()
                    if (
                        not path.is_relative_to(directory.resolve())
                        or (member.external_attr >> 16) & 0o170000 == 0o120000
                    ):
                        raise ValueError("Unsafe candidate archive entry")
                archive.extractall(directory)
                for member in archive.infolist():
                    if not member.is_dir():
                        path = directory / member.filename
                        files[path.relative_to(root).as_posix()] = {
                            "bytes": path.stat().st_size,
                            "sha256": digest(path),
                        }
        (root / f"{name}-manifest.json").write_text(
            json.dumps({"source": entry, "files": files}, indent=2), "utf-8"
        )
        print(f"Verified {name}", flush=True)


if __name__ == "__main__":
    main()
