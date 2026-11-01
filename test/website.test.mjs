// The Syntaz AI website (website/) in real Chrome, served over HTTP like GitHub Pages serves it. Google's
// Gemini API is a local stand-in: Chrome maps generativelanguage.googleapis.com to it (HTTPS with a throwaway
// certificate), so the chat's real request code, CORS and its Content-Security-Policy all apply.
// SYNTAZ_SITE_SHOTS=<folder> also saves screenshots of every page.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "website");
const CHROME = process.env.SYNTAZ_TEST_CHROME_BIN;
const SHOTS = process.env.SYNTAZ_SITE_SHOTS;
const GOOD = "AQ.SiteTestKey_abcdefghijklmnopqrstuvwxyz0123";
const PAGES = ["index.html", "features.html", "download.html", "chat.html", "safety.html", "faq.html", "changelog.html"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

let tmp, gemini, web, base, browser, page;
const seen = [];
let next = []; // scripted answers for streamGenerateContent: { status, body } or { chunks: [...] }
const sse = (chunks) => chunks.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] })}\r\n\r\n`).join("");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".css": "text/css" };

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "syntaz-site-test-"));
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "1", "-subj", "/CN=generativelanguage.googleapis.com"], { stdio: "ignore" });
  gemini = https.createServer({ key: readFileSync(path.join(tmp, "k.pem")), cert: readFileSync(path.join(tmp, "c.pem")) }, (req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-goog-api-key", "Access-Control-Allow-Methods": "GET,POST" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ url: req.url, key: req.headers["x-goog-api-key"], body });
      if (req.headers["x-goog-api-key"] !== GOOD) return res.writeHead(400, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }));
      if (req.method === "GET") return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ models: [] }));
      const n = next.shift() ?? { chunks: ["Hello from the stand-in."] };
      if (n.status) return res.writeHead(n.status, { ...cors, "Content-Type": "application/json" }).end(n.body);
      // A picture (generateContent asking for an image).
      if (req.url.includes(":generateContent")) return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] }, finishReason: "STOP" }] }));
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
      res.end(sse(n.chunks));
    });
  });
  await new Promise((r) => gemini.listen(0, "127.0.0.1", r));
  // A plain static server, like GitHub Pages.
  web = http.createServer((req, res) => {
    const file = path.join(site, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
    if (!file.startsWith(site) || !existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${web.address().port}`;
  const { default: puppeteer } = await import("puppeteer-core");
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-first-run", `--host-resolver-rules=MAP generativelanguage.googleapis.com 127.0.0.1:${gemini.address().port}`, "--ignore-certificate-errors", `--user-data-dir=${path.join(tmp, "profile")}`],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
});

after(async () => {
  await browser?.close();
  gemini?.close();
  web?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {
      /* not yet */
    }
    await sleep(150);
  }
  throw new Error("timed out waiting");
}
// What is really on screen (a CSS rule can override the hidden attribute).
const visible = (sel) => page.$eval(sel, (e) => e.getClientRects().length > 0);
const idle = () => waitFor(async () => !(await visible("#stop")) && (await visible("#send")));
const shot = (name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: !name.includes("chat") }) : null);

test("the site has all seven pages, every link between them works, and nothing is left from the design tool", () => {
  assert.deepEqual(readdirSync(site).filter((f) => f.endsWith(".html")).sort(), [...PAGES].sort());
  for (const p of PAGES) {
    const html = readFileSync(path.join(site, p), "utf8");
    assert.ok(!/\{\{|<sc-|\.dc\.html|support\.js|vendor\//.test(html), `${p}: design-tool leftovers`);
    for (const [, href] of html.matchAll(/href="([^"#:]+\.html)(#[^"]*)?"/g)) assert.ok(PAGES.includes(href), `${p} links to missing ${href}`);
    assert.match(html, /<meta name="viewport"/, `${p}: phone-ready`);
  }
});

test("search engines: every page has a title, description, canonical link and preview picture; sitemap and robots.txt", () => {
  for (const p of PAGES) {
    const html = readFileSync(path.join(site, p), "utf8");
    assert.match(html, /<title>[^<]*Syntaz AI[^<]*<\/title>/, p);
    assert.match(html, /<meta name="description" content="[^"]{60,}">/, `${p}: description`);
    assert.match(html, /<link rel="canonical" href="https:\/\/ben10-games\.github\.io\/Syntaz-AI\//, `${p}: canonical`);
    assert.match(html, /<meta property="og:image" content="https:\/\/ben10-games\.github\.io\/Syntaz-AI\/og\.png">/, `${p}: preview picture`);
  }
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(readFileSync(path.join(site, "index.html"), "utf8"))[1]);
  assert.equal(ld["@type"], "SoftwareApplication");
  assert.equal(ld.name, "Syntaz AI");
  const sitemap = readFileSync(path.join(site, "sitemap.xml"), "utf8");
  for (const p of PAGES) assert.ok(sitemap.includes(p === "index.html" ? "/Syntaz-AI/</loc>" : `/Syntaz-AI/${p}</loc>`), `sitemap lists ${p}`);
  assert.match(readFileSync(path.join(site, "robots.txt"), "utf8"), /Sitemap: https:\/\/ben10-games\.github\.io\/Syntaz-AI\/sitemap\.xml/);
  assert.ok(existsSync(path.join(site, "og.png")));
});

test("every page loads without errors, fits a phone screen, and has light and dark themes", async () => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 860 });
    for (const theme of ["dark", "light"]) {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      for (const p of PAGES) {
        await page.goto(`${base}/${p}`);
        assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), new RegExp(theme), `${p} follows the computer's theme`);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(over <= 0, `${p} at ${width}px is ${over}px too wide`);
        await shot(`${p.replace(".html", "")}-${width}-${theme}`);
      }
    }
  }
  assert.deepEqual(errors, []);
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
});

test("the theme button switches, and the choice carries over to other pages", async () => {
  await page.goto(`${base}/index.html`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.click("[data-theme-toggle]");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".site")).backgroundColor), "rgb(237, 242, 236)", "the light background");
  await page.goto(`${base}/faq.html`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.click("[data-theme-toggle]");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
});

test("Download: the steps start on the visitor's computer and the tabs switch them", async () => {
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36");
  await page.goto(`${base}/download.html`);
  const shown = () => page.$$eval("[data-panel]", (ps) => ps.filter((p) => p.getClientRects().length > 0).map((p) => p.dataset.panel));
  assert.deepEqual(await shown(), ["win"]);
  assert.equal(await page.$eval('[data-tab="win"]', (b) => b.getAttribute("aria-pressed")), "true");
  await page.click('[data-tab="mac"]');
  assert.deepEqual(await shown(), ["mac"]);
  assert.match(await page.$eval('[data-panel="mac"]', (p) => p.textContent), /Open Anyway/);
  await page.click('[data-tab="lite"]');
  assert.deepEqual(await shown(), ["lite"]);
  const links = await page.$$eval("a[href*='releases/latest/download']", (a) => [...new Set(a.map((x) => x.href.split("/").pop()))].sort());
  assert.deepEqual(links, ["Syntaz-Lite.html", "Syntaz-for-Linux.zip", "Syntaz-for-Mac.zip", "Syntaz-for-Windows.zip"]);
  const lts = await page.$$eval("a[href*='releases/download/lts/']", (a) => a.map((x) => x.href.split("/").pop()));
  assert.deepEqual(lts, ["Syntaz-for-Windows.zip", "Syntaz-for-Mac.zip", "Syntaz-for-Linux.zip"], "LTS downloads");
  // Linux: its own tab first for Linux visitors, and the one-line install with a Copy button.
  await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36");
  await page.goto(`${base}/download.html`);
  assert.deepEqual(await shown(), ["linux"]);
  assert.equal(await page.$eval("#linuxCmd", (c) => c.textContent), "curl -fsSL https://ben10-games.github.io/Syntaz-AI/install.sh | bash");
  assert.ok(existsSync(path.join(site, "install.sh")), "the install script is on the site");
  await page.setUserAgent(await browser.userAgent());
});

test("Chat (full screen, like Syntaz Lite): asks for a key, checks it with Google, then chats for real", async () => {
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(`${base}/chat.html`);
  assert.equal(await visible("#setup"), true);
  assert.equal(await page.$eval("h1", (e) => e.textContent), "Chat with Syntaz AI");
  await page.type("#key", "AQ.WrongKey_000000000000000000000000000");
  await page.click("#saveKey");
  await waitFor(async () => /doesn't work/.test(await page.$eval("#keyMsg", (e) => e.textContent)));
  await page.$eval("#key", (i) => (i.value = ""));
  await page.type("#key", GOOD);
  await page.click("#saveKey");
  await waitFor(() => page.$eval("#app", (a) => !a.hidden)); // display: contents, so no box of its own
  // Full screen: the conversation and message box fill the window, with a way back to the site.
  const box = await page.$eval("main", (m) => m.getBoundingClientRect().height);
  assert.ok(box >= 840, `the chat fills the window (${box}px)`);
  assert.deepEqual(await page.$$eval(".side-foot a.site-link", (a) => a.map((x) => x.getAttribute("href"))), ["download.html", "index.html"]);
  next.push({ chunks: ["391.\n\n**Bold** and `code`\n\n", '<img src=x onerror="window.hacked=1">'] });
  await page.click("#input");
  await page.keyboard.type("what is 17 times 23?");
  await page.keyboard.press("Enter");
  await idle();
  const html = await page.evaluate(() => [...document.querySelectorAll(".msg.ai .b")].pop().innerHTML);
  assert.match(html, /<p>391\.<\/p>/);
  assert.match(html, /<b>Bold<\/b> and <code>code<\/code>/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  assert.match(seen.at(-1).url, /gemini-3\.1-flash-lite:streamGenerateContent/);
  await shot("chat-conversation-1280-dark");
});

test("Chat: the 🎨 button makes a picture with Download; Gemini's free tier is explained plainly", async () => {
  await page.click("#picture");
  assert.equal(await page.$eval("#picture", (b) => b.getAttribute("aria-pressed")), "true");
  assert.equal(await page.$eval("#input", (i) => i.placeholder), "Describe the picture you want…");
  next.push({ image: true });
  await page.click("#input");
  await page.keyboard.type("a cat in space");
  await page.keyboard.press("Enter");
  await waitFor(() => page.evaluate(() => !!document.querySelector(".msg.ai img.made")));
  const req = seen.filter((x) => x.url.includes(":generateContent")).at(-1);
  assert.match(req.url, /gemini-3\.1-flash-image:generateContent/);
  assert.deepEqual(JSON.parse(req.body).generationConfig.responseModalities, ["IMAGE", "TEXT"]);
  assert.equal(await page.$eval(".msg.ai img.made", (i) => i.src), `data:image/png;base64,${PNG_B64}`);
  assert.equal(await page.$eval(".msg.ai a.made-save", (a) => a.getAttribute("download")), "syntaz-picture.png");
  assert.equal(await page.$eval("#picture", (b) => b.getAttribute("aria-pressed")), "false", "back to normal messages");
  // Typing "draw …" also makes a picture; the free tier allows none → said what to do.
  next.push({ status: 429, body: JSON.stringify({ error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_input_token_count, limit: 0" } }) });
  await page.click("#input");
  await page.keyboard.type("draw a dog");
  await page.keyboard.press("Enter");
  await waitFor(async () => /only makes pictures on a paid plan: the free tier allows none/.test(await page.$eval("#list", (e) => e.textContent)));
  await shot("chat-picture-1280-dark");
});

test("Chat: chats are saved in this browser and come back after a reload", async () => {
  await page.reload();
  await waitFor(() => page.$eval("#app", (a) => !a.hidden)); // display: contents, so no box of its own
  const titles = await page.$$eval("#chatList .open", (b) => b.map((x) => x.textContent));
  assert.ok(titles.includes("what is 17 times 23?"), JSON.stringify(titles));
  assert.ok(seen.every((x) => !x.key || x.key === GOOD || x.key.startsWith("AQ.Wrong")), "the key only ever goes to Google");
});
