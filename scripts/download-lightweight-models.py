"""Download and verify fixed public models; never reads or sends meeting audio."""

import argparse
import json
from pathlib import Path
import shutil
import sys
import tarfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import (  # noqa: E402
    ASSETS,
    DEFAULT_MODELS,
    LICENSE_URLS,
    NATIVE_WINDOWS,
    digest,
    verify,
)


def download(url, target):
    with urllib.request.urlopen(url, timeout=120) as source, target.open("wb") as out:
        shutil.copyfileobj(source, out, 1024 * 1024)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument(
        "--native-windows",
        type=Path,
        help="Also unpack the pinned Windows CPU tools here",
    )
    args = parser.parse_args()
    args.models.mkdir(parents=True, exist_ok=True)
    for name, asset in ASSETS.items():
        try:
            verify(args.models, [name])
        except ValueError:
            target = args.models / name
            temporary = target.with_suffix(target.suffix + ".download")
            print(f"Downloading {name} ({asset['bytes']} bytes)", flush=True)
            try:
                download(asset["url"], temporary)
                if (
                    temporary.stat().st_size != asset["bytes"]
                    or digest(temporary) != asset["sha256"]
                ):
                    raise ValueError(f"Download verification failed: {name}")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        print(f"Verified {name}", flush=True)
    licenses = args.models / "licenses"
    licenses.mkdir(exist_ok=True)
    provenance = {}
    for name, url in LICENSE_URLS.items():
        target = licenses / name
        download(url, target)
        provenance[name] = {"url": url, "sha256": digest(target)}
    (args.models / "manifest.json").write_text(
        json.dumps({"assets": ASSETS, "licenses": provenance}, indent=2), "utf-8"
    )
    print(f"Ready: {sum(a['bytes'] for a in ASSETS.values())} model bytes")
    if args.native_windows:
        directory = args.native_windows.resolve()
        directory.mkdir(parents=True, exist_ok=True)
        archive = directory / (NATIVE_WINDOWS["name"] + ".tar.bz2")
        if not archive.is_file() or digest(archive) != NATIVE_WINDOWS["sha256"]:
            download(NATIVE_WINDOWS["url"], archive)
        if (
            archive.stat().st_size != NATIVE_WINDOWS["bytes"]
            or digest(archive) != NATIVE_WINDOWS["sha256"]
        ):
            raise ValueError("Native runtime download verification failed")
        with tarfile.open(archive) as source:
            for member in source.getmembers():
                if not (directory / member.name).resolve().is_relative_to(directory):
                    raise ValueError("Unsafe native archive member")
            source.extractall(directory, filter="data")
        (directory / "manifest.json").write_text(
            json.dumps(NATIVE_WINDOWS, indent=2), "utf-8"
        )


if __name__ == "__main__":
    main()
