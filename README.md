# Syntaz AI

<img src="website/icon.svg" width="72" alt="Syntaz AI logo">

**An AI helper that lives in Chrome's side panel.** Ask about the page you're on, or tell it what to do — "open remix beatbox on YouTube", "fill this out", "summarize this video" — and it does it in your browser, with your approval. It uses your own AI key: Google Gemini (free), OpenAI, Anthropic (Claude), xAI (Grok), Groq, Hugging Face, or your own AI server (LM Studio, Ollama).

Website: **https://ben10-games.github.io/Syntaz-AI/**

## Get Syntaz

| | What it is | Get it |
| --- | --- | --- |
| **Chrome extension** | Syntaz in Chrome's side panel: knows the page and does things for you. Works on its own — nothing else to install. | [Syntaz-Chrome-Extension.zip](https://github.com/ben10-games/Syntaz-AI/releases/latest/download/Syntaz-Chrome-Extension.zip) |
| **Desktop app** | The Syntaz chat in its own window, with an icon on your desktop. Works offline to open. | [Install from the website](https://ben10-games.github.io/Syntaz-AI/download.html) |
| **Syntaz Lite** | One HTML file: double-click it, chat (pictures too). For school laptops that can't install anything. | [Syntaz-Lite.html](https://github.com/ben10-games/Syntaz-AI/releases/latest/download/Syntaz-Lite.html) |
| **Website chat** | The same chat, right on the website. | [Open the chat](https://ben10-games.github.io/Syntaz-AI/chat.html) |

### Add the extension to Chrome (about 2 minutes)

1. Unzip **Syntaz-Chrome-Extension.zip**. Keep the **Syntaz AI** folder somewhere it can stay.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the **Syntaz AI** folder.
4. Pin Syntaz (puzzle icon), then click it or press **Alt+N** on any page.
5. In **⚙ Settings → Your AI**, choose an AI, paste its key (**Get a key ↗** opens the right page) and click **Save & check**.

A free Gemini key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → copy. With a paid AI you pay that company for what you use; set a monthly limit in your account.

**Updating:** unzip the new version over the old folder, then click ↻ on Syntaz in `chrome://extensions`. Your key and settings stay.

## What the extension does

- **It knows which page you're on.** The line above the message box shows the tab Syntaz is watching. Page text goes to your AI only with a message you send, marked as untrusted website content. Password fields, form values, card numbers and long tokens are never included. Sites need your permission first (**Allow** opens Chrome's prompt).
- **Modes:** **Auto** answers questions and does tasks ("search the web for…", "open…", "fill in…") with the browser tools; **Chat** only answers; **Actions** always uses the tools.
- **Every action is approved.** Before a click, typing or selection, Syntaz checks the target on the live page, then shows a card saying what will really happen (*Type “12” into the field “x =” (not submitted)*): **Allow once**, **Deny** or **Always allow on this site**. After the action it verifies the result in the page and reports the real outcome.
- **Never on its own:** it doesn't type into password, payment or one-time-code fields, doesn't solve CAPTCHAs, never makes up your personal details, and only submits, sends, buys or deletes when your own words ask for it (and you still confirm it).
- **Entering answers:** "solve this and enter the answer" works the problem out step by step first, then types only the final answer into the matching field and reads it back.
- **Sees the page** (with an AI that takes pictures): graphs, charts and diagrams via `look_at_page`, and **📷** adds a screenshot to your next message.
- **What a video says:** YouTube transcripts with timestamps ("what did he just say?", "summarize this video").
- **🎨 Pictures** with OpenAI, xAI (Grok), Hugging Face, or Gemini with billing on.
- **🙌 Hands-off mode** (until Chrome closes): does the whole task without a card for each ordinary step, up to 25 steps, and checks every part was done. Submitting and sending still ask unless you allow that too; buying, paying, deleting and anything on school homework sites always ask.
- **Shortcuts** (`/summarize`, `/explain`, `/solve`, … and your own), **saved chats** (off by default), right-click **Ask Syntaz about …**, and Syntaz's cursor showing where it acts.
- **Stop (■)** ends a task at once; **Pause** in ⚙ stops all browser actions until you resume.

## For developers

Everything runs in the browser; there is no server.

- `chrome-extension/` — the extension (Manifest V3).
  - `ai.js` — talks to the AI providers directly (streaming, tool calls, pictures, plain-language errors). Every provider is called with the user's key straight from the browser.
  - `tools.js` — the browser tools the AI can use (`get_page`, `list_elements`, `click`, `fill_field`, `site_search`, …), with the safety checks before anything reaches the page.
  - `agent.js` — the step-by-step task loop: reads the page first, asks for approval, refuses risky calls, writes up partial results.
  - `local-api.js` — answers the side panel's `/api/...` requests (chat, agent, approvals, status, pictures) inside the extension.
  - `background.js`, `page-lib.js`, `page-cursor.js`, `page-watch.js` — the browser commands (`protocol.json`, checked by `protocol-check.js`) that act on pages.
- `lite/Syntaz Lite.html` — Syntaz Lite (one file). `python3 scripts/sync-ai.py` copies `ai.js` into it and remakes `website/chat.html`.
- `website/` — the website (GitHub Pages, published by `.github/workflows/website.yml`), including the desktop app (`manifest.webmanifest`, `sw.js`).

Tests run in real Chrome with stand-in AIs:

```bash
npm install
SYNTAZ_TEST_CHROME_BIN=/usr/bin/google-chrome npm test
```

`npm run icons` remakes every icon from `website/icon.svg`.

### Publishing a release

1. Raise `"version"` in `chrome-extension/manifest.json` and `package.json`, commit and push.
2. `npm run release` — makes `dist/Syntaz-Chrome-Extension.zip` and `dist/Syntaz-Lite.html` from the committed project.
3. On GitHub: **Releases → Draft a new release** → tag `v2.0.0` (the same number) → drag in the two files → **Publish release**.

**LTS:** `npm run release:lts` makes the same files in `dist/lts`; put them on the release tagged `lts` (named e.g. **Syntaz 2.0.1 LTS**). The website's LTS buttons point at it.

## Privacy

No accounts, no Syntaz server. Your key, settings and saved chats stay in your browser. Messages, and the page text you send with them, go straight from your browser to the AI you chose — nowhere else.
