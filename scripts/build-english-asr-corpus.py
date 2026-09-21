"""Freeze public English audio and published references for local CPU evaluation.

Downloads stay in .local. References never enter the recognizer's corpus JSON.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request
import wave

AA_REVISION = "5999936ee3d8d3cde160e3c65a8cc6ff5b7c5276"
NORMALIZER_REVISION = "86098128c0b4f24f0e2aa2994de830614b474227"
AA = "https://huggingface.co/datasets/ArtificialAnalysis/Earnings22-Cleaned-AA"
ARCHIVES = {
    "test-clean": "32fa31d27d2e1cad72775fee3f4849a9",
    "test-other": "fb5a50374b501bb3bac4815ee91d3135",
}
SEED = "meeting-recorder-english-v1"


def digest(path, algorithm="sha256"):
    with path.open("rb") as source:
        return hashlib.file_digest(source, algorithm).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")


def download(url, target):
    if target.exists():
        return
    partial = target.with_suffix(target.suffix + ".partial")
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {target.name}", flush=True)
    with (
        urllib.request.urlopen(url, timeout=120) as response,
        partial.open("wb") as dest,
    ):
        while block := response.read(1024 * 1024):
            dest.write(block)
    partial.replace(target)
    print(f"Downloaded {target.name}: {target.stat().st_size:,} bytes", flush=True)


def decode(source, target):
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            "aresample=16000:async=1:first_pts=0",
            "-c:a",
            "pcm_s16le",
            str(target),
        ],
        check=True,
        capture_output=True,
    )


def duration(path):
    with wave.open(str(path), "rb") as source:
        return source.getnframes() / source.getframerate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if (root / "corpus.json").exists():
        raise ValueError("Frozen corpus already exists; use a new output directory")
    downloads, audio = root / "downloads", root / "audio"
    downloads.mkdir(exist_ok=True)
    audio.mkdir(exist_ok=True)
    plan = {
        "seed": SEED,
        "librispeech": "Two SHA256-ranked utterances per speaker in each test split; 3-25 seconds",
        "earnings22": "First two parent IDs in lexicographic order; entire calls, no exclusions",
        "chunking": "Contiguous non-overlapping chunks: lowest 200 ms RMS midpoint between 18-28 s; retain all audio",
        "inference": "Qwen3 0.6B INT8 and SenseVoice INT8; CPU, 4 threads, auto language, no hotwords",
        "scoring": "Micro word error rate on whole reference units; official Whisper English normalizer; also basic lexical WER",
        "scope": "Public subset, not full benchmark; speaker identification is not evaluated",
        "aa_revision": AA_REVISION,
        "normalizer_revision": NORMALIZER_REVISION,
    }
    save(root / "evaluation-plan.json", plan)
    jobs = [
        (
            f"https://openslr.trmal.net/resources/12/{name}.tar.gz",
            downloads / f"{name}.tar.gz",
        )
        for name in ARCHIVES
    ]
    jobs += [
        (f"{AA}/resolve/{AA_REVISION}/{name}", downloads / name)
        for name in ("README.md", "earnings22_cleaned_aa_v1.jsonl")
    ]
    normalizers = root / "whisper_normalizers"
    for name in ("__init__.py", "basic.py", "english.py", "english.json"):
        jobs.append(
            (
                f"https://raw.githubusercontent.com/openai/whisper/{NORMALIZER_REVISION}/whisper/normalizers/{name}",
                normalizers / name,
            )
        )
    jobs.append(
        (
            f"https://raw.githubusercontent.com/openai/whisper/{NORMALIZER_REVISION}/LICENSE",
            normalizers / "LICENSE",
        )
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda job: download(*job), jobs))
    corpus = {
        "schema_version": 1,
        "reference_kind": "public_dataset",
        "meetings": [],
        "samples": [],
    }
    reference = {
        "reference_kind": "published_dataset",
        "plan": plan,
        "sources": [],
        "units": [],
    }

    def add_sample(sid, group, unit, wav, start=0):
        sample = {
            "id": sid,
            "meeting_id": unit,
            "split": "holdout",
            "group": group,
            "audio": wav.relative_to(root).as_posix(),
            "decoded_sha256": digest(wav),
            "duration_seconds": duration(wav),
            "start_seconds": start,
            "baseline": [],
        }
        corpus["samples"].append(sample)
        return sid

    for split, expected_md5 in ARCHIVES.items():
        archive = downloads / f"{split}.tar.gz"
        if digest(archive, "md5") != expected_md5:
            raise ValueError(f"Published archive MD5 mismatch: {split}")
        references, by_speaker = {}, {}
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                if member.isfile() and member.name.endswith(".trans.txt"):
                    for line in source.extractfile(member).read().decode().splitlines():
                        sid, text = line.split(" ", 1)
                        references[sid] = text
                elif member.isfile() and member.name.endswith(".flac"):
                    # FLAC's first STREAMINFO metadata block holds the exact sample count.
                    header = source.extractfile(member).read(26)
                    if header[:4] != b"fLaC" or header[4] & 127 != 0:
                        raise ValueError("Unexpected FLAC header")
                    packed = int.from_bytes(header[18:26], "big")
                    seconds = (packed & ((1 << 36) - 1)) / (packed >> 44)
                    if 3 <= seconds <= 25:
                        sid = Path(member.name).stem
                        by_speaker.setdefault(sid.split("-")[0], []).append(sid)
        selected = set()
        for speaker in sorted(by_speaker):
            selected.update(
                sorted(
                    by_speaker[speaker],
                    key=lambda sid: hashlib.sha256(
                        f"{SEED}:{sid}".encode()
                    ).hexdigest(),
                )[:2]
            )
        reference["sources"].append(
            {
                "group": split,
                "url": "https://openslr.org/12/",
                "license": "CC BY 4.0",
                "archive_sha256": digest(archive),
                "published_md5": expected_md5,
                "speakers": len(by_speaker),
                "selected_ids": sorted(selected),
            }
        )
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                sid = Path(member.name).stem
                if not member.name.endswith(".flac") or sid not in selected:
                    continue
                flac, wav = audio / f"{sid}.flac", audio / f"{sid}.wav"
                flac.write_bytes(source.extractfile(member).read())
                decode(flac, wav)
                unit = f"{split}-{sid}"
                corpus["meetings"].append({"id": unit, "context": {"keywords": []}})
                add_sample(unit, split, unit, wav)
                reference["units"].append(
                    {
                        "id": unit,
                        "group": split,
                        "speaker": sid.split("-")[0],
                        "sample_ids": [unit],
                        "text": references[sid],
                    }
                )
        print(
            f"Selected {split}: {len(selected)} utterances, {len(by_speaker)} speakers",
            flush=True,
        )

    import numpy as np

    calls = sorted(
        [
            json.loads(line)
            for line in (downloads / "earnings22_cleaned_aa_v1.jsonl")
            .read_text("utf-8")
            .splitlines()
        ],
        key=lambda row: row["id"],
    )[:2]
    for call in calls:
        name = Path(call["file_name"]).name
        original = downloads / name
        download(f"{AA}/resolve/{AA_REVISION}/audio/{name}", original)
        full_wav = audio / f"{Path(name).stem}-full.wav"
        decode(original, full_wav)
        with wave.open(str(full_wav), "rb") as source:
            pcm = source.readframes(source.getnframes())
        samples = np.frombuffer(pcm, dtype="<i2")
        seconds = len(samples) / 16000
        # Published metadata rounds/truncates durations to integer seconds.
        if abs(seconds - float(call["duration"])) > 1.0:
            raise ValueError("Call duration differs from published metadata")
        unit = f"earnings22-{call['id']}"
        corpus["meetings"].append({"id": unit, "context": {"keywords": []}})
        ids, start, chunk = [], 0, 0
        while start < len(samples):
            end = len(samples)
            if end - start > 28 * 16000:
                candidates = range(start + 18 * 16000, start + 28 * 16000, 1600)
                end = min(
                    candidates,
                    key=lambda p: float(
                        np.mean(samples[p - 1600 : p + 1600].astype(np.float64) ** 2)
                    ),
                )
            sid = f"{unit}-{chunk:03}"
            wav = audio / f"{sid}.wav"
            with wave.open(str(wav), "wb") as target:
                target.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                target.writeframes(pcm[start * 2 : end * 2])
            ids.append(add_sample(sid, "earnings22", unit, wav, start / 16000))
            start, chunk = end, chunk + 1
        reference["units"].append(
            {
                "id": unit,
                "group": "earnings22",
                "sample_ids": ids,
                "text": call["transcript"],
            }
        )
        reference["sources"].append(
            {
                "group": "earnings22",
                "id": call["id"],
                "url": AA,
                "revision": AA_REVISION,
                "license": "Apache-2.0 (dataset card)",
                "original_sha256": digest(original),
                "full_wav_sha256": digest(full_wav),
                "duration_seconds": seconds,
                "published_duration_seconds": call["duration"],
                "chunks": len(ids),
            }
        )
        print(
            f"Selected full call {call['id']}: {seconds:.2f}s, {len(ids)} chunks",
            flush=True,
        )
    save(root / "corpus.json", corpus)
    reference["corpus_sha256"] = digest(root / "corpus.json")
    reference["sample_audio_sha256"] = {
        s["id"]: s["decoded_sha256"] for s in corpus["samples"]
    }
    reference["normalizer_sha256"] = {
        p.name: digest(p) for p in normalizers.iterdir() if p.is_file()
    }
    save(root / "references.json", reference)
    print(
        f"Frozen {len(corpus['samples'])} chunks, {sum(s['duration_seconds'] for s in corpus['samples']) / 60:.2f} minutes",
        flush=True,
    )


if __name__ == "__main__":
    main()
