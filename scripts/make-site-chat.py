#!/usr/bin/env python3
"""Makes website/chat.html from Syntaz Lite (lite/Syntaz Lite.html): the same full-screen chat (sidebar, chats,
pictures, the 🎨 button), with the website's name, search-engine details, a way back to the site and a Download
button. Run after changing Syntaz Lite:  python3 scripts/make-site-chat.py"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://ben10-games.github.io/Syntaz-AI"
src = open(os.path.join(ROOT, "lite", "Syntaz Lite.html"), encoding="utf-8").read()


def rep(s, a, b, count=1):
    assert s.count(a) == count, (a[:70], s.count(a))
    return s.replace(a, b)


s = src
s = rep(s, "<title>Syntaz Lite</title>", f'''<title>Chat with Syntaz AI – free AI chat in your browser</title>
<meta name="description" content="Chat with Syntaz AI right in your browser: answers, help with homework photos, writing, quizzes and pictures. Free with a Google Gemini key (or use OpenAI, Claude, Grok, Groq or Hugging Face), nothing to install.">
<link rel="canonical" href="{SITE}/chat.html">
<meta property="og:title" content="Chat with Syntaz AI">
<meta property="og:description" content="Free AI chat in your browser, with pictures. Nothing to install.">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:url" content="{SITE}/chat.html">''')
# Its own saved chats and key (separate from Syntaz Lite files on the same computer).
s = rep(s, "syntaz-lite:", "syntaz-site-chat:", count=7)
s = rep(s, "<h1>Welcome to Syntaz Lite</h1>", "<h1>Chat with Syntaz AI</h1>")
s = rep(s, "<b>Syntaz Lite</b><button class=\"icon\" id=\"closeChats\"", "<b><a href=\"index.html\" style=\"color:inherit;text-decoration:none\" title=\"Syntaz AI home\">Syntaz AI</a></b><button class=\"icon\" id=\"closeChats\"")
s = rep(s, "<b>Syntaz Lite</b><button class=\"icon\" id=\"newChatTop\"", "<b><a href=\"index.html\" style=\"color:inherit;text-decoration:none\">Syntaz AI</a></b><button class=\"icon\" id=\"newChatTop\"")
s = rep(s, '''    <div class="side-foot">
''', '''    <div class="side-foot">
      <a class="site-link" href="download.html"><svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Get Syntaz for Chrome</a>
      <a class="site-link" href="index.html"><svg class="i" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>Syntaz AI home</a>
''')
# The desktop app: the chat is what it opens (manifest.webmanifest), and it works offline (sw.js).
s = rep(s, "img-src data: blob: https:;", "img-src 'self' data: blob: https:;")
s = rep(s, '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';', '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="theme-color" content="#050807">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; manifest-src \'self\'; worker-src \'self\';')
s = rep(s, '      <a class="site-link" href="index.html">', '''      <button class="site-link" id="installApp" hidden><svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>Install the Syntaz app</button>
      <a class="site-link" href="index.html">''')
s = rep(s, "\nif (ai) showApp(); else showSetup(false);", '''
// Desktop app: offer to install this chat as an app (Chrome/Edge), and keep it working offline.
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
let installOffer = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installOffer = e; $("installApp").hidden = false; });
addEventListener("appinstalled", () => ($("installApp").hidden = true));
$("installApp").onclick = () => installOffer && installOffer.prompt();
if (ai) showApp(); else showSetup(false);''')
s = rep(s, "</style>", "  .side-foot .site-link { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 10px; color: var(--muted); text-decoration: none; }\n  .side-foot .site-link:hover { background: var(--hover); color: var(--text); }\n</style>")
s = rep(s, "<!-- Syntaz Lite: Syntaz in one file.", "<!-- Made from Syntaz Lite by scripts/make-site-chat.py: edit lite/Syntaz Lite.html, then run that script.\n     Syntaz Lite: Syntaz in one file.")
open(os.path.join(ROOT, "website", "chat.html"), "w", encoding="utf-8").write(s)
print("wrote website/chat.html")
