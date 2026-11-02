// The release downloads (scripts/make-release.py): the Chrome extension as a ZIP, and Syntaz Lite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("release: the extension ZIP (manifest at the top of a 'Syntaz AI' folder) and Syntaz Lite, nothing else", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "syntaz-release-"));
  try {
    const r = spawnSync("python3", ["-I", path.join(root, "scripts", "make-release.py"), "--out", out], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(out).sort(), ["Syntaz-Chrome-Extension.zip", "Syntaz-Lite.html"]);
    const names = JSON.parse(spawnSync("python3", ["-I", "-c", "import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", path.join(out, "Syntaz-Chrome-Extension.zip")], { encoding: "utf8" }).stdout);
    assert.ok(names.every((n) => n.startsWith("Syntaz AI/")), "everything is inside the Syntaz AI folder");
    for (const f of ["manifest.json", "sidepanel.html", "ai.js", "agent.js", "tools.js", "local-api.js", "background.js", "icons/syntaz-128.png"]) assert.ok(names.includes(`Syntaz AI/${f}`), f);
    assert.ok(!names.some((n) => /test|\.md$/.test(n)), "only the extension's own files");
    assert.match(readFileSync(path.join(out, "Syntaz-Lite.html"), "utf8"), /<title>Syntaz Lite<\/title>/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
