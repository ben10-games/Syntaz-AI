// Syntaz liquid glass. Each .lg element gets a lens map drawn at its own size, so its edges bend what's
// behind it (like a thick glass pebble) while the middle stays clear; the CSS uses it as var(--lens).
// Chrome only: other browsers, and "reduce transparency", keep the plain frosted glass.
// The same file is in website/liquid.js and chrome-extension/liquid.js (Syntaz Lite has it inline).
(() => {
  // Which elements are glass: <script src="liquid.js" data-glass=".panel,.card"> (default .lg).
  const GLASS = document.currentScript?.dataset.glass || ".lg";
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "svg");
  defs.setAttribute("width", "0"); defs.setAttribute("height", "0"); defs.setAttribute("aria-hidden", "true");
  defs.style.position = "absolute";
  (document.body || document.documentElement).prepend(defs);
  const made = new Map();
  // Distance from the rounded-rect edge → how hard the glass bends there (0 in the middle).
  function lensMap(w, h, r, edge) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Signed distance to a rounded rectangle, and the direction to its nearest edge.
      const qx = Math.abs(x + 0.5 - w / 2) - (w / 2 - r), qy = Math.abs(y + 0.5 - h / 2) - (h / 2 - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const dist = r - (Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0)); // inward distance from the edge
      const t = Math.max(0, 1 - dist / edge); const k = t * t * t; // strong at the rim, gone by `edge` px in
      let nx, ny;
      if (ox > 0 || oy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
      nx *= Math.sign(x + 0.5 - w / 2); ny *= Math.sign(y + 0.5 - h / 2);
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * k * 127; d[i + 1] = 128 - ny * k * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  function filterFor(el) {
    const b = el.getBoundingClientRect(); const w = Math.round(b.width), h = Math.round(b.height);
    if (w < 8 || h < 8 || w * h > 1_500_000) return null; // tiny, or too big to draw quickly
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
    const edge = Math.min(28, Math.max(10, Math.min(w, h) * 0.32));
    const id = `lg-${w}-${h}-${Math.round(r)}`;
    if (!made.has(id)) {
      const f = document.createElementNS(NS, "filter");
      f.id = id;
      for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) f.setAttribute(k, v);
      f.innerHTML = `<feImage href="${lensMap(w, h, r, edge)}" x="0" y="0" width="${w}" height="${h}" result="map"/>
        <feDisplacementMap in="SourceGraphic" in2="map" scale="${Math.round(edge * 1.4)}" xChannelSelector="R" yChannelSelector="G"/>`;
      defs.append(f);
      made.set(id, f);
    }
    return id;
  }
  const chrome = CSS.supports("backdrop-filter", "url(#x)") && /Chrome\//.test(navigator.userAgent) && !matchMedia("(prefers-reduced-transparency: reduce)").matches;
  function apply(el) {
    if (!chrome) return;
    const id = filterFor(el);
    if (id) el.style.setProperty("--lens", `url(#${id})`);
  }
  const ro = new ResizeObserver((items) => items.forEach((i) => apply(i.target)));
  const watch = (root) => root.querySelectorAll?.(GLASS).forEach((el) => { if (!el.dataset.lg) { el.dataset.lg = "1"; ro.observe(el); apply(el); } });
  watch(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.(GLASS) ? watch(n.parentNode) : watch(n))))).observe(document.body, { childList: true, subtree: true });
  // The light on the glass follows the pointer.
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(`${GLASS},.btn`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  });
})();
