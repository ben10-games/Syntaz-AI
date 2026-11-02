#!/usr/bin/env python3
"""Copies the shared code into Syntaz Lite (so it stays one file): the AI connector (chrome-extension/ai.js) and the
liquid glass (website/liquid.js, also copied to chrome-extension/liquid.js), then remakes the website chat from Lite.
Run after changing ai.js, liquid.js or Lite:
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
# Liquid glass: one file for the website and the extension, inline in Lite (its <script data-glass=...> tag).
liquid = open(os.path.join(ROOT, "website", "liquid.js"), encoding="utf-8").read()
open(os.path.join(ROOT, "chrome-extension", "liquid.js"), "w", encoding="utf-8").write(liquid)
m = re.search(r'(<script data-glass="[^"]*">\n)(.*?)(</script>)', s, flags=re.S)
assert m and "liquid glass" in m.group(2), "could not find the liquid glass script in Syntaz Lite"
s = s[: m.start(2)] + liquid + s[m.end(2) :]
open(LITE, "w", encoding="utf-8").write(s)
print("updated lite/Syntaz Lite.html")
subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make-site-chat.py")], check=True)
