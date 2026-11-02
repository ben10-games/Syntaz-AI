// The real Chrome extension on its own: the side panel talks straight to an AI (here a stand-in AI server with
// scripted answers) and does browser tasks with approval cards. Needs Chrome: SYNTAZ_TEST_CHROME_BIN=/usr/bin/google-chrome
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.SYNTAZ_TEST_CHROME_BIN;

/** A stand-in AI with the OpenAI API: answers come from `script` in order (text, or a tool call). */
function startFakeAi() {
  const seen = [];
  const script = [];
  const server = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (req.url === "/v1/models") return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake-large" }, { id: "fake-small" }] }));
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const data = JSON.parse(body);
      seen.push(data);
      const last = data.messages.at(-1);
      const next = /Reply with: OK/.test(JSON.stringify(last.content)) ? { text: "OK" } : script.shift() || { text: "(no scripted answer)" };
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (next.tool) {
        chunk({ tool_calls: [{ index: 0, id: `call_${seen.length}`, type: "function", function: { name: next.tool, arguments: "" } }] });
        chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(next.args || {}) } }] }, "tool_calls");
      } else {
        for (const part of next.text.match(/.{1,8}/gs)) chunk({ content: part });
        chunk({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, script, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

describe("the extension on its own, with your own AI", { skip: !CHROME && "set SYNTAZ_TEST_CHROME_BIN to run" }, () => {
  let ai, site, browser, sw, page, panel, tmp, EXT, siteBase;
  const logs = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await fn().catch(() => null);
      if (v) return v;
      await sleep(100);
    }
    throw new Error("timed out waiting");
  };
  const text = (sel) => panel.$eval(sel, (e) => e.textContent);
  const lastAssistant = () => panel.evaluate(() => [...document.querySelectorAll(".msg.assistant")].pop()?.innerText ?? "");
  const idle = () => panel.evaluate(() => document.getElementById("stop").hidden);
  const say = async (msg) => {
    await panel.click("#input");
    await panel.type("#input", msg);
    await panel.keyboard.press("Enter");
  };

  before(async () => {
    const { default: puppeteer } = await import("puppeteer-core");
    tmp = mkdtempSync(path.join(os.tmpdir(), "syntaz-ext-test-"));
    ai = await startFakeAi();
    site = http.createServer((req, res) => {
      const name = path.basename(req.url.split("?")[0]) || "index.html";
      try {
        const html = readFileSync(path.join(root, "test/fixtures/site", name));
        res.writeHead(200, { "Content-Type": "text/html" }).end(html);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((r) => site.listen(0, "127.0.0.1", r));
    siteBase = `http://localhost:${site.address().port}`;
    const extDir = path.join(tmp, "ext");
    cpSync(path.join(root, "chrome-extension"), extDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(extDir, "manifest.json"), "utf8"));
    // Stands in for the user allowing this site (localhost) and the AI server (127.0.0.1) when Chrome asks.
    manifest.host_permissions = [...new Set([...manifest.host_permissions, "http://localhost/*", "http://127.0.0.1/*"])];
    writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, userDataDir: path.join(tmp, "profile"), args: ["--no-first-run", "--no-default-browser-check"] });
    const id = await browser.installExtension(extDir);
    EXT = `chrome-extension://${id}`;
    sw = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith(`${EXT}/`))).worker();
    await waitFor(() => sw.evaluate(() => typeof chrome !== "undefined" && !!chrome.storage?.local));
    page = await browser.newPage();
    await page.goto(`${siteBase}/form.html`);
    // Open the real side panel (a click gives the user gesture Chrome requires, like clicking the toolbar icon).
    const helper = await browser.newPage();
    await helper.goto(`${EXT}/sidepanel.html#helper`);
    const winId = await helper.evaluate(async () => (await chrome.windows.getCurrent()).id);
    await helper.evaluate((w) => document.body.addEventListener("click", () => chrome.sidePanel.open({ windowId: w }), { once: true }), winId);
    await helper.bringToFront();
    await helper.mouse.click(5, 5);
    const target = await waitFor(async () => browser.targets().find((t) => t.url() === `${EXT}/sidepanel.html` && t !== helper.target()));
    panel = await target.asPage();
    panel.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
    panel.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await panel.reload();
    await helper.close();
    await page.bringToFront();
  });

  after(async () => {
    await Promise.race([browser?.close(), sleep(5000)]);
    browser?.process()?.kill("SIGKILL");
    ai?.server.close();
    site?.closeAllConnections();
    site?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("without a key the panel says so and points to Settings; nothing else is needed", async () => {
    await waitFor(async () => (await text("#syntazStatus")) === "No AI yet");
    assert.match(await text("#bannerText"), /key in Settings/);
    assert.equal(await panel.$("#bridgeStatus"), null, "no browser bridge any more");
    assert.deepEqual(logs.filter((l) => /^(error|pageerror)/.test(l)), [], "the panel loads without script errors");
  });

  test("choosing an AI, checking it and picking a model in Settings", async () => {
    await panel.click("#toggleSettings");
    const providers = await panel.$$eval("#aiProvider option", (o) => o.map((x) => x.value));
    assert.deepEqual(providers, ["gemini", "openai", "anthropic", "xai", "groq", "huggingface", "custom"]);
    assert.match(await panel.$eval("#aiKeyLink", (a) => a.href), /aistudio\.google\.com/);
    await panel.select("#aiProvider", "custom");
    assert.equal(await panel.$eval("#aiBaseRow", (e) => e.hidden), false);
    await panel.type("#aiBase", ai.url);
    await panel.click("#aiSave");
    await waitFor(async () => /Works!/.test(await text("#aiMsg")));
    await waitFor(async () => (await text("#syntazStatus")) === "My own AI server (LM Studio, Ollama, …)");
    assert.deepEqual(await panel.$$eval("#modelSelect option", (o) => o.map((x) => x.value)), ["", "fake-large", "fake-small"]);
    await panel.select("#modelSelect", "fake-small");
    await waitFor(async () => (await sw.evaluate(async () => (await chrome.storage.local.get("ai")).ai.model)) === "fake-small");
    await panel.click("#closeSettings");
  });

  test("chat answers come straight from the AI, with the page shared", async () => {
    await waitFor(async () => /Form Test/.test(await text("#ctxText")));
    const before = ai.seen.length;
    ai.script.push({ text: "This page is a **form test**." });
    await say("what is this page?");
    await waitFor(async () => ai.seen.length > before && (await idle()));
    const sent = ai.seen.at(-1);
    assert.equal(sent.model, "fake-small");
    assert.equal(sent.messages[0].role, "system");
    assert.match(sent.messages.at(-1).content, /Form test[\s\S]*User request: what is this page\?/);
    assert.match(await lastAssistant(), /This page is a form test\./);
  });

  test("a task: the page is read first, the action waits for approval, then really happens", async () => {
    ai.script.push({ tool: "fill_field", args: { field: "Notes", text: "hello" } }, { text: "I typed hello into Notes." });
    await say("type hello into the notes box");
    await waitFor(async () => panel.evaluate(() => !!document.querySelector(".msg.assistant:last-child .approval button.primary:not(:disabled)")));
    const card = await panel.$eval(".msg.assistant:last-child .approval", (e) => e.innerText);
    assert.match(card, /Type “hello” into the field “Notes” \(not submitted\)/);
    assert.equal(await page.$eval("#notes", (e) => e.value), "", "nothing typed before approval");
    await panel.click(".msg.assistant:last-child .approval button.primary");
    await waitFor(async () => (await idle()) && /I typed hello/.test(await lastAssistant()));
    assert.equal(await page.$eval("#notes", (e) => e.value), "hello");
    // The AI saw the page before choosing, and got the real result of the action back.
    const first = ai.seen.find((b) => b.tools && JSON.stringify(b.messages).includes("type hello into the notes box"));
    assert.ok(first.tools.some((t) => t.function.name === "fill_field"));
    assert.match(JSON.stringify(first.messages), /Form test/);
    const lastBody = JSON.stringify(ai.seen.at(-1).messages);
    assert.match(lastBody, /Entered \\"hello\\" into/);
  });

  test("a denied action is not done, and the AI is told", async () => {
    ai.script.push({ tool: "click", args: { target: "Go to page 2" } }, { text: "OK, I didn't open page 2." });
    await say("click go to page 2");
    await waitFor(async () => panel.evaluate(() => !!document.querySelector(".msg.assistant:last-child .approval button:not(.primary):not(:disabled)")));
    await panel.evaluate(() => [...document.querySelectorAll(".msg.assistant:last-child .approval button")].find((b) => b.textContent === "Deny").click());
    await waitFor(async () => (await idle()) && /didn't open page 2/.test(await lastAssistant()));
    assert.match(page.url(), /form\.html$/);
    assert.match(JSON.stringify(ai.seen.at(-1).messages), /did not approve/);
  });

  test("password fields are refused before anyone is asked", async () => {
    ai.script.push({ tool: "fill_field", args: { field: "Password", text: "secret" } }, { text: "I can't type passwords." });
    await say("type secret into the password box");
    await waitFor(async () => (await idle()) && /can't type passwords/.test(await lastAssistant()));
    assert.equal(await panel.$(".msg.assistant:last-child .approval button.primary"), null, "no approval card");
    assert.equal(await page.$eval("#pw", (e) => e.value), "hunter2");
  });

  test("pictures: an AI that can't make them says which ones can", async () => {
    await panel.click("#pictureBtn");
    await say("a cat in space");
    await waitFor(async () => /can't make pictures[\s\S]*Settings/.test(await lastAssistant()));
    assert.deepEqual(logs.filter((l) => /^pageerror/.test(l)), []);
  });
});
