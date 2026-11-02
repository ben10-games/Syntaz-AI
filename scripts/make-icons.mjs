// Makes every Syntaz icon from the one logo, website/icon.svg (a dark glass rounded square with a lime-to-mint
// "S" and a spark): the Chrome extension's PNGs and the desktop app's icons.
// Chrome draws the SVG at each size, so every icon matches the logo exactly.
// Run from the project folder: node scripts/make-icons.mjs   (needs Chrome; set SYNTAZ_TEST_CHROME_BIN if it isn't found)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [process.env.SYNTAZ_TEST_CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!chrome) throw new Error("Chrome not found: set SYNTAZ_TEST_CHROME_BIN");
const svg = readFileSync(path.join(root, "website", "icon.svg"), "utf8");
const { default: puppeteer } = await import("puppeteer-core");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();

/** The logo as a PNG of `size` px; `margin` (share of the size) leaves room around it (macOS icon grid). */
async function png(size, margin = 0) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const inner = Math.round(size * (1 - 2 * margin));
  const off = Math.round((size - inner) / 2);
  await page.setContent(`<html><body style="margin:0;background:transparent"><img style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`);
  await page.waitForFunction(() => document.querySelector("img").complete);
  return Buffer.from(await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
const save = (buf, ...parts) => {
  const file = path.join(root, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
};

for (const s of [16, 32, 48, 128]) save(await png(s), "chrome-extension", "icons", `syntaz-${s}.png`);

// The desktop app (installed from the website): a plain icon, and a "maskable" one with room to crop to a circle.
for (const s of [192, 512]) save(await png(s), "website", `icon-${s}.png`);
save(await png(512, 0.12), "website", "icon-maskable.png");
save(await png(180), "website", "apple-touch-icon.png");
await browser.close();
console.log("icons written");
