// Syntaz Lite (lite/Syntaz Lite.html) in real Chrome, opened as a local file. The AIs are local stand-ins: Chrome maps
// generativelanguage.googleapis.com (Gemini) and api.groq.com (Groq) to them (HTTPS with a throwaway certificate),
// so the page's real request code, CORS and its Content-Security-Policy all apply.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.SYNTAZ_TEST_CHROME_BIN;
const GOOD = "AQ.LiteTestKey_abcdefghijklmnopqrstuvwxyz0123";
const GROQ = "gsk_LiteTestGroqKey_0123456789abcdef";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tmp, server, browser, page;
const seen = [];
let next = []; // scripted answers for chat: { status, body } or { chunks: [...] }, and for pictures: { image } or { status, body }

const sse = (chunks) => chunks.map((t) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n";
const MODELS = { gemini: [{ id: "models/gemini-3.6-flash" }, { id: "models/gemini-3.1-flash-lite" }, { id: "models/text-embedding-004" }], groq: [{ id: "openai/gpt-oss-120b" }, { id: "llama-3.3-70b-versatile" }] };

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "syntaz-lite-test-"));
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "1", "-subj", "/CN=stand-in"], { stdio: "ignore" });
  server = https.createServer({ key: readFileSync(path.join(tmp, "k.pem")), cert: readFileSync(path.join(tmp, "c.pem")) }, (req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,authorization,x-goog-api-key", "Access-Control-Allow-Methods": "GET,POST" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const host = req.headers.host.split(":")[0];
      const who = host === "api.groq.com" ? "groq" : "gemini";
      const auth = req.headers.authorization?.replace(/^Bearer /, "") || req.headers["x-goog-api-key"];
      seen.push({ host, url: req.url, auth, body });
      const reply = (status, data, type = "application/json") => res.writeHead(status, { ...cors, "Content-Type": type }).end(typeof data === "string" ? data : JSON.stringify(data));
      if (auth !== (who === "groq" ? GROQ : GOOD)) return reply(who === "groq" ? 401 : 400, { error: { message: "API key not valid. Please pass a valid API key." } });
      if (req.url.endsWith("/models")) return reply(200, { data: MODELS[who] });
      if (req.url.includes(":generateContent")) {
        const n = next.shift() ?? {};
        if (n.status) return reply(n.status, n.body);
        return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: n.image } }] } }] });
      }
      if (/Reply with: OK/.test(body)) return reply(200, sse(["OK"]), "text/event-stream");
      const n = next.shift() ?? { chunks: ["Hello from the stand-in."] };
      if (n.status) return reply(n.status, n.body);
      reply(200, sse(n.chunks), "text/event-stream");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { default: puppeteer } = await import("puppeteer-core");
  const port = server.address().port;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-first-run", `--host-resolver-rules=MAP generativelanguage.googleapis.com 127.0.0.1:${port},MAP api.groq.com 127.0.0.1:${port}`, "--ignore-certificate-errors", `--user-data-dir=${path.join(tmp, "profile")}`],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
});

after(async () => {
  await browser?.close();
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const lite = () => `file://${path.join(root, "lite", "Syntaz Lite.html")}`;
const visible = (sel) => page.$eval(sel, (e) => !e.hidden);
const lastAnswer = () => page.evaluate(() => [...document.querySelectorAll(".msg.ai .b")].pop()?.innerHTML ?? "");
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
async function say(text) {
  await page.click("#input");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
const idle = () => waitFor(() => page.$eval("#stop", (b) => b.hidden));

const chatBodies = (host = "generativelanguage.googleapis.com") => seen.filter((x) => x.host === host && x.url.endsWith("/chat/completions") && !/Reply with: OK/.test(x.body)).map((x) => JSON.parse(x.body));

test("first open: choose an AI (Gemini first, it's free), paste the key, it's checked and remembered", async () => {
  await page.goto(lite());
  assert.equal(await visible("#setup"), true);
  assert.deepEqual(await page.$$eval("#provider option", (o) => o.map((x) => x.value)), ["gemini", "openai", "anthropic", "xai", "groq", "huggingface", "custom"]);
  assert.match(await page.$eval("#keyLink", (a) => a.href), /aistudio\.google\.com/);
  await page.type("#key", "nope");
  await page.click("#saveKey");
  await waitFor(async () => /doesn't look like an API key/.test(await page.$eval("#keyMsg", (e) => e.textContent)));
  await page.$eval("#key", (i) => (i.value = ""));
  await page.type("#key", "AQ.WrongKey_000000000000000000000000000");
  await page.click("#saveKey");
  await waitFor(async () => /key doesn.t work/.test(await page.$eval("#keyMsg", (e) => e.textContent)));
  await page.$eval("#key", (i) => (i.value = ""));
  await page.type("#key", GOOD);
  await page.click("#saveKey");
  await waitFor(() => visible("#app"));
  await waitFor(async () => (await page.$$eval("#model option", (o) => o.length)) === 2);
  assert.deepEqual(await page.$$eval("#model option", (o) => o.map((x) => x.textContent)), ["Flash-Lite · fast, most free uses", "Flash · smarter, ~20 a day"], "chat models only (the free-friendly one first), with friendly names");
  await page.select("#model", "gemini-3.1-flash-lite");
  await page.reload();
  await waitFor(() => visible("#app")); // remembered
  assert.equal(await page.$eval("#model", (s) => s.value), "gemini-3.1-flash-lite");
});

test("answers stream in, Markdown is shown, and the AI's text can't run code in the page", async () => {
  next.push({ chunks: ["391.\n\n**Bold** and `code`\n\n", "```\nlet x = 1;\n```\n", "5. fifth\n6. sixth\n\n", '<img src=x onerror="window.hacked=1"><script>window.hacked=2</script>'] });
  await say("hi");
  await idle();
  const html = await lastAnswer();
  assert.match(html, /<b>Bold<\/b> and <code>code<\/code>/);
  assert.match(html, /<pre><code>let x = 1;<\/code><button class="copycode">Copy<\/button><\/pre>/, "code blocks have their own Copy button");
  assert.match(html, /^<p>391\.<\/p>/, "a number alone on a line stays (it isn't an empty list item)");
  assert.match(html, /<ol><li value="5">fifth<\/li><li value="6">sixth<\/li><\/ol>/, "numbered lists keep their numbers");
  assert.match(html, /&lt;img src=x onerror=/, "HTML from the AI is shown as text");
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  const req = chatBodies().at(-1);
  assert.equal(req.model, "gemini-3.1-flash-lite");
  assert.equal(req.messages.at(-1).content, "hi");
  assert.match(req.messages[0].content, /You are Syntaz/);
  assert.equal(req.reasoning_effort, "none", "Flash-Lite: thinking off (fast)");
  assert.equal(seen.at(-1).auth, GOOD);
});

test("a picture goes to the AI (made smaller, JPEG) and shows in the chat", async () => {
  const png = path.join(tmp, "pic.png");
  // A real 2000x1000 PNG, made by Chrome itself.
  const dataUrl = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 2000; c.height = 1000; c.getContext("2d").fillRect(0, 0, 50, 50); return c.toDataURL("image/png"); });
  writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));
  const input = await page.$("#file");
  await input.uploadFile(png);
  await waitFor(() => page.$eval("#thumbs", (t) => t.children.length === 1));
  next.push({ chunks: ["A black square."] });
  await page.click("#send");
  await idle();
  const parts = chatBodies().at(-1).messages.at(-1).content;
  assert.equal(parts[0].text, "What is in this picture?");
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
  const size = await page.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = u; }), parts[1].image_url.url);
  assert.deepEqual(size, [1600, 800]);
  assert.equal(await page.$$eval(".msg.user img", (i) => i.length), 1);
});

test("making pictures with 🎨, and a plain answer when Gemini's free tier makes none", async () => {
  const dot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  next.push({ image: dot });
  await page.click("#picture");
  await say("a green dot");
  await idle();
  assert.equal(await page.$eval(".msg.ai:last-child img.made", (i) => i.src), `data:image/png;base64,${dot}`);
  assert.match(seen.at(-1).url, /gemini-3\.1-flash-image:generateContent/);
  next.push({ status: 429, body: JSON.stringify({ error: { message: "Quota exceeded for metric generate_content_free_tier_requests, limit: 0" } }) });
  await say("draw a cat");
  await idle();
  assert.match(await lastAnswer(), /free tier/i);
});

test("free-tier limits: Syntaz waits when the AI asks, and says plainly when today's limit is used up", async () => {
  next.push({ status: 429, body: JSON.stringify([{ error: { message: "Resource exhausted", details: [{ retryDelay: "1s" }] } }]) }, { chunks: ["After waiting."] });
  await say("again");
  await idle();
  assert.match(await lastAnswer(), /After waiting\./);
  next.push({ status: 429, body: JSON.stringify([{ error: { message: "Quota exceeded, GenerateRequestsPerDayPerProjectPerModel-FreeTier" } }]) });
  await say("and again");
  await idle();
  assert.match(await lastAnswer(), /Today's free limit for this model is used up/);
  assert.ok(await page.$(".msg.ai:last-child button"), "with a Retry button");
});

test("chats are saved in the browser (without the pictures) and can be reopened and deleted", async () => {
  await page.click("#newChat");
  await page.reload();
  await waitFor(() => visible("#app"));
  assert.equal(await visible("#chats"), true, "on a wide screen the chats are always shown");
  const titles = await page.$$eval("#chatList .open", (b) => b.map((x) => x.textContent));
  assert.equal(titles[0], "hi");
  await page.click("#chatList .open");
  await waitFor(async () => /A black square\./.test(await page.$eval("#list", (l) => l.innerText)));
  assert.match(await page.$eval("#list", (l) => l.innerText), /1 picture\(s\) \(not saved\)/);
  const stored = await page.evaluate(() => localStorage.getItem("syntaz-lite:chats"));
  assert.ok(!stored.includes("base64") && stored.length < 5_000, "no picture data in storage");
  await page.click("#chatList .chat button.icon");
  assert.equal(await page.$$eval("#chatList .open", (b) => b.length), 0);
});

test("another AI: switch to Groq in Key & settings, and the chat goes to Groq with its key", async () => {
  await page.click("#settings");
  await waitFor(() => visible("#setup"));
  await page.select("#provider", "groq");
  assert.match(await page.$eval("#keyLink", (a) => a.href), /console\.groq\.com/);
  await page.type("#key", GROQ);
  await page.click("#saveKey");
  await waitFor(() => visible("#app"));
  assert.equal(await page.$eval("#model", (s) => s.value), "openai/gpt-oss-120b", "Syntaz picks the best model for Groq");
  next.push({ chunks: ["Hi from Groq."] });
  await say("hello groq");
  await idle();
  assert.match(await lastAnswer(), /Hi from Groq\./);
  const last = seen.filter((x) => x.host === "api.groq.com").at(-1);
  assert.equal(last.auth, GROQ);
  assert.equal(JSON.parse(last.body).model, "openai/gpt-oss-120b");
  assert.match(await page.evaluate(() => localStorage.getItem("syntaz-lite:ai")), /"provider":"groq"/);
});

test("an older Syntaz Lite's saved Gemini key keeps working", async () => {
  await page.evaluate((k) => { localStorage.clear(); localStorage.setItem("syntaz-lite:key", JSON.stringify(k)); }, GOOD);
  await page.reload();
  await waitFor(() => visible("#app"));
  assert.match(await page.evaluate(() => localStorage.getItem("syntaz-lite:ai")), /"provider":"gemini"/);
  assert.equal(await page.evaluate(() => localStorage.getItem("syntaz-lite:key")), null);
});

test("the page talks to no one but the AIs (Content-Security-Policy)", async () => {
  const blocked = await page.evaluate(() => fetch("https://example.com/").then(() => "sent", () => "blocked"));
  assert.equal(blocked, "blocked");
});
