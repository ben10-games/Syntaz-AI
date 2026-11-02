// Syntaz AI website: shared by every page. Loaded in <head>, so the theme is set before the page shows.
"use strict";
(() => {
  const KEY = "syntaz-site:theme";
  const saved = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; } };
  const system = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const apply = () => (document.documentElement.dataset.theme = saved() || system());
  apply();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", apply);

  // The desktop app works offline too (sw.js).
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

  document.addEventListener("DOMContentLoaded", () => {
    // Copy buttons (e.g. the Linux install command).
    for (const b of document.querySelectorAll("[data-copy]")) {
      b.addEventListener("click", () => {
        const text = document.getElementById(b.dataset.copy)?.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => { b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy"), 1500); }, () => {});
      });
    }

    // Light/dark button: follows the computer until you press it.
    for (const b of document.querySelectorAll("[data-theme-toggle]")) {
      b.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        try { localStorage.setItem(KEY, next); } catch {}
        apply();
        if (!saved()) document.documentElement.dataset.theme = next; // storage blocked: still switch for this page
      });
    }

    // Desktop app: Chrome/Edge offer to install the site as an app; [data-install] buttons ask for it.
    const installed = matchMedia("(display-mode: standalone)").matches;
    const show = (sel, on) => document.querySelectorAll(sel).forEach((e) => (e.hidden = !on));
    show("[data-installed]", installed);
    show("[data-install-help]", !installed);
    let offer = null;
    addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      offer = e;
      show("[data-install]", true);
      show("[data-install-help]", false);
    });
    addEventListener("appinstalled", () => {
      show("[data-install]", false);
      show("[data-install-help]", false);
      show("[data-installed]", true);
    });
    for (const b of document.querySelectorAll("[data-install]")) b.addEventListener("click", () => offer && offer.prompt());
  });
})();
