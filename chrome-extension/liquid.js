// Syntaz liquid glass. Each glass element gets its own SVG filter, used by the CSS as var(--lens): the edge is a
// rounded bevel, and light bends through it by Snell's law (glass, n≈1.5), so what's behind the rim is pulled inward
// and magnified while the middle stays flat and sharp. The frost after it is Chrome's own (fast) blur, and the bright
// rims come from the CSS. Pressing glass makes it bulge (the bend grows, then springs back); the light on it follows
// the pointer.
// Built to stay light: one displacement per element (measured: 3 colour layers and SVG blur made pages run at about
// 25 fps), lenses only while an element is on screen, and if the computer still can't keep up (frames slower than
// ~30 fps), the glass switches to plain frosted glass for this visit.
// Chrome only: other browsers, and "reduce transparency", keep the plain frosted glass (the CSS fallback).
// The same file is in website/liquid.js and chrome-extension/liquid.js; scripts/sync-ai.py copies it into Syntaz Lite.
(() => {
  // Which elements are glass: <script src="liquid.js" data-glass=".panel,.card"> (default .lg).
  const GLASS = document.currentScript?.dataset.glass || ".lg";
  const NS = "http://www.w3.org/2000/svg";
  const N_GLASS = 1.5;
  const MAX_LENSES = 24; // more glass than this on screen at once: the rest stays plain frosted glass
  const defs = document.createElementNS(NS, "svg");
  defs.setAttribute("width", "0"); defs.setAttribute("height", "0"); defs.setAttribute("aria-hidden", "true");
  defs.style.position = "absolute";
  (document.body || document.documentElement).prepend(defs);

  // How far light bends at each depth into the bevel (0 = the very edge, 1 = where the flat middle starts).
  // The bevel is a convex squircle, h(t) = (1 − (1 − t)⁴)^¼: steep at the edge, flat inside.
  const PROFILE = (() => {
    const n = 128, out = new Float32Array(n + 1);
    const h = (t) => Math.pow(1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4), 0.25);
    let max = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, dt = 1 / n;
      const slope = (h(t + dt / 2) - h(t - dt / 2)) / dt; // surface slope
      const inc = Math.atan(slope); // angle between the view ray and the surface normal
      const bent = Math.asin(Math.sin(inc) / N_GLASS); // the ray inside the glass
      out[i] = Math.tan(inc - bent); // sideways shift per unit of thickness
      max = Math.max(max, out[i]);
    }
    for (let i = 0; i <= n; i++) out[i] /= max || 1;
    return (t) => out[Math.round(Math.min(Math.max(t, 0), 1) * n)];
  })();

  /** The displacement map (R = x, G = y; 128 = no shift) for a w×h rounded rectangle (cached by size). */
  const maps = new Map();
  function drawMap(w, h, r, edge) {
    const key = `${w}x${h}r${Math.round(r)}e${Math.round(edge)}`;
    if (maps.has(key)) return maps.get(key);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); const img = ctx.createImageData(w, h); const d = img.data;
    d.fill(128);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    // Only the bevel needs work: the flat middle stays 128 (no shift).
    const band = Math.ceil(edge + r * 0.3) + 1; // a rounded corner's bevel reaches a bit further in
    for (let y = 0; y < h; y++) {
      const inside = y >= band && y < h - band;
      for (let x = 0; x < w; x++) {
        if (inside && x === band) x = Math.max(band, w - band); // skip the middle of this row
        // Signed distance to the rounded rectangle, and the outward direction of its nearest edge.
        const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
        const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        const dist = r - (Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0)); // how far inside the edge
        const t = dist / edge;
        if (t >= 1) continue;
        let nx, ny;
        if (ox > 0 || oy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
        nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        const k = PROFILE(t), i = (y * w + x) * 4;
        // Pull inward (sample further inside): that magnifies what's behind the rim, like a real lens edge.
        d[i] = 128 - nx * k * 127; d[i + 1] = 128 - ny * k * 127;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    maps.set(key, url);
    if (maps.size > 40) maps.delete(maps.keys().next().value);
    return url;
  }

  let next = 0;
  const glass = new WeakMap(); // element → { filter, displacer, scale, bulge, frost }
  const visible = new Set();
  let plain = false;
  try { plain = sessionStorage.getItem("syntaz-glass") === "plain"; } catch {}

  function build(el) {
    if (plain || !visible.has(el)) return;
    const b = el.getBoundingClientRect(); const w = Math.round(b.width), h = Math.round(b.height);
    if (w < 8 || h < 8 || w * h > 1_200_000) return off(el); // tiny, or too big to bend cheaply
    const css = getComputedStyle(el);
    const r = Math.min(parseFloat(css.borderTopLeftRadius) || 0, w / 2, h / 2);
    const edge = Math.min(36, Math.max(10, Math.min(w, h) * 0.36));
    let g = glass.get(el);
    if (!g) {
      const f = document.createElementNS(NS, "filter");
      f.id = `lg${++next}`;
      defs.append(f);
      g = { filter: f, displacer: null, scale: 0, bulge: 1 };
      glass.set(el, g);
    }
    g.scale = edge * 1.25;
    g.frost = parseFloat(css.getPropertyValue("--frost")) || 2;
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) g.filter.setAttribute(k, v);
    g.filter.innerHTML = `<feImage href="${drawMap(w, h, r, edge)}" x="0" y="0" width="${w}" height="${h}" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${(g.scale * g.bulge).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>`;
    g.displacer = g.filter.firstElementChild.nextElementSibling;
    el.style.setProperty("--lens", `url(#${g.filter.id}) blur(${g.frost}px)`);
  }
  /** Back to plain frosted glass (off screen, too many, or a slow computer). */
  function off(el) {
    el.style.removeProperty("--lens");
    const g = glass.get(el);
    if (g) { g.filter.remove(); glass.delete(el); }
  }

  // Pressing glass: the bend swells like a drop of liquid, then springs back (a damped spring).
  function bulge(el, target) {
    const g = glass.get(el);
    if (!g || reduceMotion.matches) return;
    g.target = target;
    if (g.anim) return;
    let v = 0;
    const step = () => {
      v = (v + (g.target - g.bulge) * 0.18) * 0.72;
      g.bulge += v;
      g.displacer.setAttribute("scale", (g.scale * g.bulge).toFixed(1));
      if (Math.abs(v) < 0.002 && Math.abs(g.target - g.bulge) < 0.002) { g.anim = 0; return; }
      g.anim = requestAnimationFrame(step);
    };
    g.anim = requestAnimationFrame(step);
  }

  // Too slow? Measure 40 frames now and then (after loading, and while scrolling); a median slower than ~30 fps
  // means this computer can't bend the glass smoothly, so it gets plain frosted glass (until the browser closes).
  let measuring = false, lastCheck = 0;
  function check() {
    if (plain || measuring || document.hidden || Date.now() - lastCheck < 4000) return;
    measuring = true;
    const times = [];
    let last = 0;
    const tick = (t) => {
      if (last) times.push(t - last);
      last = t;
      if (times.length < 40) return requestAnimationFrame(tick);
      measuring = false;
      lastCheck = Date.now();
      times.sort((a, b) => a - b);
      if (times[20] > 34) goPlain();
    };
    requestAnimationFrame(tick);
  }
  function goPlain() {
    plain = true;
    try { sessionStorage.setItem("syntaz-glass", "plain"); } catch {}
    document.querySelectorAll("[data-lg]").forEach(off);
  }

  const chrome = CSS.supports("backdrop-filter", "url(#x)") && /Chrome\//.test(navigator.userAgent) && !matchMedia("(prefers-reduced-transparency: reduce)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if (chrome && !plain) {
    // Lenses only for glass on screen (and at most MAX_LENSES of them).
    const io = new IntersectionObserver((items) => {
      for (const i of items) {
        if (i.isIntersecting && visible.size < MAX_LENSES) { visible.add(i.target); build(i.target); }
        else if (!i.isIntersecting && visible.delete(i.target)) off(i.target);
      }
    }, { rootMargin: "120px" });
    const ro = new ResizeObserver((items) => items.forEach((i) => build(i.target)));
    const watch = (root) => root.querySelectorAll?.(GLASS).forEach((el) => { if (!el.dataset.lg) { el.dataset.lg = "1"; io.observe(el); ro.observe(el); } });
    watch(document);
    new MutationObserver((ms) => ms.forEach((m) => {
      m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.(GLASS) ? watch(n.parentNode) : watch(n)));
      m.removedNodes.forEach((n) => { if (n.nodeType === 1 && n.dataset?.lg) { visible.delete(n); off(n); } });
    })).observe(document.body, { childList: true, subtree: true });
    let pressed = null;
    document.addEventListener("pointerdown", (e) => { pressed = e.target.closest?.(GLASS); if (pressed) bulge(pressed, 1.7); });
    const release = () => { if (pressed) bulge(pressed, 1); pressed = null; };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    setTimeout(check, 800);
    addEventListener("scroll", check, { passive: true, capture: true });
  }
  // The light on the glass follows the pointer (at most once per frame).
  let moved = null;
  document.addEventListener("pointermove", (e) => {
    if (!moved) requestAnimationFrame(() => {
      const el = moved.target.closest?.(`${GLASS},.btn`);
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", `${moved.clientX - r.left}px`);
        el.style.setProperty("--y", `${moved.clientY - r.top}px`);
      }
      moved = null;
    });
    moved = e;
  }, { passive: true });
})();
