#!/bin/bash
# Syntaz Setup for Linux: opens the Syntaz window (install, update, uninstall). Uses Node.js if this computer has
# it, otherwise gets its own copy the first time (setup/get-node.sh: no installer, no sudo).
# Run it from a file manager (Run as program) or a terminal:  ./"Syntaz Setup (Linux).sh"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
LOCAL="${XDG_DATA_HOME:-$HOME/.local/share}/syntaz/node/bin/node"
[ -z "$NODE" ] && [ -x "$LOCAL" ] && NODE="$LOCAL"
if [ -z "$NODE" ]; then
  echo "Getting Syntaz ready (the first time only, about a minute)…"
  NODE="$(/bin/bash "$DIR/setup/get-node.sh")" || { echo "Syntaz couldn't download what it needs. Check your internet connection and try again."; exit 1; }
fi
nohup "$NODE" "$DIR/setup/syntaz-app.mjs" >/dev/null 2>&1 &
echo "The Syntaz window is opening…"
