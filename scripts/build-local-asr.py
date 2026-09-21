"""Prepare Windows runtime and media tools; model weights download after install.

Build-time downloads only. Assets are pinned and checked before copying. No data
from a user's meeting library enters the package.
"""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from service.lightweight_models import LICENSE_URLS, digest  # noqa: E402

FFMPEG_URL = (
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip"
)
FFMPEG_SHA = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"


def download(url, path):
    if path.is_file():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    print(f"Downloading {path.name}", flush=True)
    with (
        urllib.request.urlopen(url, timeout=120) as source,
        temporary.open("wb") as dest,
    ):
        shutil.copyfileobj(source, dest, 1024 * 1024)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-worker", action="store_true")
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("Build the Windows worker on Windows")
    bundle = ROOT / ".local/bundled"
    resources, media = bundle / "local-asr", bundle / "media"
    licenses = resources / "licenses"
    for directory in (licenses, media):
        directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "shared/asr-models.json", resources / "model-catalog.json")
    for name, url in LICENSE_URLS.items():
        download(url, licenses / name)
    license_urls = {
        "Qwen3-ASR-LICENSE.txt": "https://raw.githubusercontent.com/QwenLM/Qwen3-ASR/7c6daf77a2421100f5fb066495372c00129d39ff/LICENSE",
        "CAMplus-LICENSE.txt": "https://raw.githubusercontent.com/modelscope/3D-Speaker/065629c313eaf1a01c65c640c46d77e61e9607b4/LICENSE",
        f"Python-{sys.version.split()[0]}-LICENSE.txt": f"https://raw.githubusercontent.com/python/cpython/v{sys.version.split()[0]}/LICENSE",
        "NumPy-LICENSE.txt": "https://raw.githubusercontent.com/numpy/numpy/v2.2.6/LICENSE.txt",
        "ONNX-Runtime-LICENSE.txt": "https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/LICENSE",
        "PyInstaller-COPYING.txt": "https://raw.githubusercontent.com/pyinstaller/pyinstaller/v6.16.0/COPYING.txt",
    }
    for name, url in license_urls.items():
        download(url, licenses / name)
    (resources / "THIRD-PARTY-NOTICES.txt").write_text(
        "Downloadable local speech recognition: Qwen3-ASR 0.6B INT8 (Apache-2.0); SenseVoiceSmall (see FunASR model license); "
        "sherpa-onnx (Apache-2.0); Silero VAD (MIT); Pyannote segmentation (see model license); CAM++ / 3D-Speaker (Apache-2.0).\n"
        "The standalone worker includes Python, NumPy and ONNX Runtime. PyInstaller's exception permits distribution of this executable. "
        "Full license texts are in licenses/ and worker/_internal/.\n"
        "Model source URLs and SHA-256 fingerprints: model-catalog.json; "
        "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models\n",
        "utf-8",
    )
    cache = ROOT / ".local/local-asr-build"
    archive = cache / "ffmpeg-8.1.2-essentials_build.zip"
    download(FFMPEG_URL, archive)
    if digest(archive) != FFMPEG_SHA:
        raise ValueError("FFmpeg archive fingerprint mismatch")
    with zipfile.ZipFile(archive) as source:
        for binary in ("ffmpeg.exe", "ffprobe.exe"):
            name = next(n for n in source.namelist() if n.endswith("/bin/" + binary))
            (media / binary).write_bytes(source.read(name))
        for name in source.namelist():
            if name.lower().endswith(("license", "license.txt", "readme.txt")):
                (media / Path(name).name).write_bytes(source.read(name))
    (media / "SOURCE.txt").write_text(
        f"FFmpeg 8.1.2 essentials build from {FFMPEG_URL}\nSHA-256: {FFMPEG_SHA}\n"
        "Separate GPL-licensed media executables; see the accompanying LICENSE.\n"
        "Source code and build details: https://www.gyan.dev/ffmpeg/builds/ and https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz\n",
        "utf-8",
    )
    if not args.skip_worker:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--onedir",
                "--noupx",
                "--name",
                "meeting-asr",
                "--distpath",
                str(cache / "dist"),
                "--workpath",
                str(cache / "build"),
                "--specpath",
                str(cache),
                "--paths",
                str(ROOT),
                "--collect-all",
                "sherpa_onnx",
                "--collect-all",
                "sherpa_onnx_core",
                "--exclude-module",
                "torch",
                "--exclude-module",
                "transformers",
                "--exclude-module",
                "onnxruntime",
                str(ROOT / "service/local_worker.py"),
            ],
            check=True,
        )
        shutil.copytree(
            cache / "dist/meeting-asr", resources / "worker", dirs_exist_ok=True
        )
        sources = {
            p.relative_to(ROOT).as_posix(): digest(p)
            for p in (ROOT / "service").glob("*.py")
            if not p.name.startswith("test_")
        }
        (resources / "source-manifest.json").write_text(
            json.dumps(sources, indent=2), "utf-8"
        )
    print(
        f"Prepared local ASR runtime (no model weights) at {bundle}",
        flush=True,
    )


if __name__ == "__main__":
    main()
