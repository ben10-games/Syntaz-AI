#!/bin/bash
# Gets Node.js (what Syntaz runs on) when this computer doesn't have it: the current LTS from nodejs.org, checked
# against nodejs.org's checksums, unpacked into Syntaz's own folder. No installer, no admin password.
# Prints the path to node. Used by "Syntaz Setup" (Mac) and "Syntaz Setup (Linux).sh".
set -euo pipefail
case "$(uname -s)" in
  Darwin) os=darwin; home_dir="$HOME/Library/Application Support/Syntaz" ;;
  *) os=linux; home_dir="${XDG_DATA_HOME:-$HOME/.local/share}/syntaz" ;;
esac
node="$home_dir/node/bin/node"
if [ -x "$node" ]; then echo "$node"; exit 0; fi
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; *) arch=x64 ;; esac
index=$(curl -fsSL https://nodejs.org/dist/index.json)  # read it whole first (an early stop would fail the download)
lts=$(printf '%s' "$index" | tr '{' '\n' | grep -v '"lts":false' | grep -o '"version":"v[0-9.]*"' | head -n 1 | cut -d'"' -f4 || true)
[ -n "$lts" ] || { echo "Couldn't find the current Node.js version." >&2; exit 1; }
name="node-$lts-$os-$arch"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://nodejs.org/dist/$lts/$name.tar.gz" -o "$tmp/$name.tar.gz"
sums=$(curl -fsSL "https://nodejs.org/dist/$lts/SHASUMS256.txt")
want=$(printf '%s\n' "$sums" | grep " $name.tar.gz\$" | cut -d' ' -f1 || true)
if command -v sha256sum >/dev/null; then have=$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1); else have=$(shasum -a 256 "$tmp/$name.tar.gz" | cut -d' ' -f1); fi
[ -n "$want" ] && [ "$have" = "$want" ] || { echo "The Node.js download did not match its checksum." >&2; exit 1; }
mkdir -p "$home_dir"
tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
rm -rf "$home_dir/node"
mv "$tmp/$name" "$home_dir/node"
echo "$node"
