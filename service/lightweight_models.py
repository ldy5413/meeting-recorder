"""Pinned CPU evaluation assets. No network access during inference."""

import hashlib
from pathlib import Path


DEFAULT_MODELS = (
    Path(__file__).resolve().parent.parent / ".local/lightweight-asr/models"
)
SENSE = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07"
SEGMENTATION = "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0"
SILERO = "https://raw.githubusercontent.com/snakers4/silero-vad/60b7ffa243625ebdc1070275a29f18c87843786a"
ASSETS = {
    "sensevoice.int8.onnx": {
        "url": f"{SENSE}/model.int8.onnx",
        "bytes": 239233841,
        "sha256": "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    },
    "tokens.txt": {
        "url": f"{SENSE}/tokens.txt",
        "bytes": 315894,
        "sha256": "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    },
    "silero.onnx": {
        "url": f"{SILERO}/src/silero_vad/data/silero_vad.onnx",
        "bytes": 2327524,
        "sha256": "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    },
    "segmentation.onnx": {
        "url": f"{SEGMENTATION}/model.onnx",
        "bytes": 5992913,
        "sha256": "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
    },
    "wespeaker.onnx": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx",
        "bytes": 26530550,
        "sha256": "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    },
}
LICENSE_URLS = {
    "SenseVoice-conversion-LICENSE.txt": f"{SENSE}/LICENSE",
    "FunASR-MODEL-LICENSE.txt": "https://raw.githubusercontent.com/modelscope/FunASR/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE",
    "segmentation-LICENSE.txt": f"{SEGMENTATION}/LICENSE",
    "Silero-LICENSE.txt": f"{SILERO}/LICENSE",
    "WeSpeaker-model-card.md": "https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/raw/f0c48c298fd835726c27956a5d617bad7115627e/README.md",
    "sherpa-onnx-LICENSE.txt": "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.13.8/LICENSE",
}
NATIVE_WINDOWS = {
    "name": "sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts",
    "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts.tar.bz2",
    "bytes": 23271851,
    "sha256": "4b0a94f7b5c606b1b64a19a831c2127559e4b3d34e195465ebc7be73d9ed4783",
}


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify(directory, names=None):
    for name in ASSETS if names is None else names:
        asset = ASSETS[name]
        path = Path(directory) / name
        if not path.is_file() or path.stat().st_size != asset["bytes"]:
            raise ValueError(f"Missing or incomplete model: {path}")
        if digest(path) != asset["sha256"]:
            raise ValueError(f"Model SHA-256 mismatch: {path}")
