#!/usr/bin/env python3
"""Copies the AI connector (chrome-extension/ai.js) into Syntaz Lite, so Lite stays one file that works with the same
AIs as the extension, then remakes the website chat from Lite. Run after changing ai.js or Lite:
  python3 scripts/sync-ai.py"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LITE = os.path.join(ROOT, "lite", "Syntaz Lite.html")
START = "<script>/* ai.js: copied from chrome-extension/ai.js by scripts/sync-ai.py (edit it there) */\n"
END = "</script><!-- /ai.js -->"

ai = open(os.path.join(ROOT, "chrome-extension", "ai.js"), encoding="utf-8").read()
assert "</script" not in ai.lower()
s = open(LITE, encoding="utf-8").read()
block = START + ai.rstrip("\n") + "\n" + END
if START in s:
    s = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, s, count=1, flags=re.S)
else:
    s = s.replace("\n<script>\n\"use strict\";\nconst PROVIDERS", "\n" + block + "\n<script>\n\"use strict\";\nconst PROVIDERS", 1)
    assert START in s, "could not find where to put ai.js in Syntaz Lite"
open(LITE, "w", encoding="utf-8").write(s)
print("updated lite/Syntaz Lite.html")
subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make-site-chat.py")], check=True)
