#!/usr/bin/env python3
"""Builds the downloads for a GitHub release from the committed project (git HEAD):
  dist/Syntaz-Chrome-Extension.zip  the Chrome extension (unzips to a "Syntaz AI" folder: Load unpacked in Chrome)
  dist/Syntaz-Lite.html             Syntaz Lite: chat in one file, nothing to install
The names never change, so the website's links (releases/latest/download/...) always find the newest ones.
Run from the project folder: python3 scripts/make-release.py [--out DIR] [--lts]
  --lts: the same downloads for the LTS channel (into dist/lts), for the GitHub release tagged lts"""
import io
import json
import os
import stat
import subprocess
import sys
import tarfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP = "Syntaz AI"


def main():
    lts = "--lts" in sys.argv
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "dist", "lts" if lts else "")
    os.makedirs(out, exist_ok=True)
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty:
        print("Note: only committed changes are included (uncommitted changes exist).")
    tar_bytes = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, capture_output=True, check=True).stdout
    members = {}
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        for m in tar.getmembers():
            if m.isfile():
                members[m.name] = tar.extractfile(m).read()
    version = json.loads(members["chrome-extension/manifest.json"])["version"]

    path = os.path.join(out, "Syntaz-Chrome-Extension.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(members.items()):
            if not name.startswith("chrome-extension/"):
                continue
            info = zipfile.ZipInfo(f"{TOP}/{name[len('chrome-extension/'):]}", date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    print(f"Syntaz-Chrome-Extension.zip: {os.path.getsize(path) // 1024} KB")

    lite = members["lite/Syntaz Lite.html"]
    with open(os.path.join(out, "Syntaz-Lite.html"), "wb") as f:
        f.write(lite)
    print(f"Syntaz-Lite.html: {len(lite) // 1024} KB")
    if lts:
        print(f"LTS {version}. Put these on the GitHub release tagged \"lts\", named \"Syntaz {version} LTS\" (replace its old files).")
    else:
        print(f"Version {version}. Upload these as a GitHub release tagged v{version}.")


if __name__ == "__main__":
    main()
