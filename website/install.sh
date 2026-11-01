#!/bin/bash
# Installs Syntaz AI on Linux:  curl -fsSL https://ben10-games.github.io/Syntaz-AI/install.sh | bash
# Downloads the newest Syntaz-for-Linux.zip from GitHub into ~/Syntaz AI (keeping your settings if it's already
# there), then opens the Syntaz window, which finishes the setup. Nothing needs sudo.
set -euo pipefail
ZIP_URL="${SYNTAZ_INSTALL_ZIP:-https://github.com/ben10-games/Syntaz-AI/releases/latest/download/Syntaz-for-Linux.zip}"
DEST="${SYNTAZ_INSTALL_DIR:-$HOME/Syntaz AI}"
echo "Installing Syntaz AI into: $DEST"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$ZIP_URL" -o "$tmp/syntaz.zip"
if command -v unzip >/dev/null; then
  unzip -q "$tmp/syntaz.zip" -d "$tmp/x"
elif command -v python3 >/dev/null; then
  python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/syntaz.zip" "$tmp/x"
else
  echo "Please install 'unzip' (e.g. sudo apt install unzip) and run this again." >&2
  exit 1
fi
mkdir -p "$DEST"
# Keep this computer's settings and installed parts when updating an existing folder.
cp -a "$tmp/x/Syntaz AI/." "$DEST/"
chmod +x "$DEST/Syntaz Setup (Linux).sh" "$DEST/setup/get-node.sh"
echo "Opening the Syntaz window…"
"$DEST/Syntaz Setup (Linux).sh"
