// Syntaz liquid glass. Each glass element gets its own SVG filter, used by the CSS as var(--lens):
//  1. a little frost (blur) — real glass is mostly clear,
//  2. refraction: the edge is a rounded bevel, and light bends through it by Snell's law (glass, n≈1.5), so what's
//     behind the rim is pulled inward and magnified while the middle stays flat and sharp,
//  3. dispersion: red, green and blue bend by slightly different amounts, so the rim shows a faint rainbow fringe,
//  4. specular light: a bright glint along the rim facing the light (top left) and a softer one on the opposite side.
// Pressing glass makes it bulge (the bend grows, then springs back); the light on it follows the pointer.
// Chrome only: other browsers, and "reduce transparency", keep the plain frosted glass (the CSS fallback).
// The same file is in website/liquid.js and chrome-extension/liquid.js; scripts/sync-ai.py copies it into Syntaz Lite.
(() => {
  // Which elements are glass: <script src="liquid.js" data-glass=".panel,.card"> (default .lg).
  const GLASS = document.currentScript?.dataset.glass || ".lg";
  const NS = "http://www.w3.org/2000/svg";
  const N_GLASS = 1.5;
  const LIGHT = [-0.6, -0.8]; // where the light comes from: top left
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
      const out_ = Math.asin(Math.sin(inc) / N_GLASS); // the bent ray inside the glass
      out[i] = Math.tan(inc - out_); // sideways shift per unit of thickness
      max = Math.max(max, out[i]);
    }
    for (let i = 0; i <= n; i++) out[i] /= max || 1;
    return (t) => out[Math.round(Math.min(Math.max(t, 0), 1) * n)];
  })();

  /** The displacement map (R = x, G = y; 128 = no shift) and the light map for a w×h rounded rectangle. */
  const maps = new Map();
  function drawMaps(w, h, r, edge) {
    const key = `${w}x${h}r${Math.round(r)}e${Math.round(edge)}`;
    if (maps.has(key)) return maps.get(key);
    const make = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const cd = make(), cs = make();
    const xd = cd.getContext("2d"), xs = cs.getContext("2d");
    const id = xd.createImageData(w, h), is = xs.createImageData(w, h);
    const d = id.data, s = is.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Signed distance to the rounded rectangle, and the outward direction of its nearest edge.
      const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const dist = r - (Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0)); // how far inside the edge
      let nx, ny;
      if (ox > 0 || oy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
      const t = dist / edge;
      const k = t < 1 ? PROFILE(t) : 0;
      const i = (y * w + x) * 4;
      // Pull inward (sample further inside): that magnifies what's behind the rim, like a real lens edge.
      d[i] = 128 - nx * k * 127; d[i + 1] = 128 - ny * k * 127; d[i + 2] = 128; d[i + 3] = 255;
      // Light: a thin bright line right at the rim, strongest where the edge faces the light.
      const facing = nx * LIGHT[0] + ny * LIGHT[1];
      const rim = Math.exp(-Math.max(dist, 0) / 1.6) + 0.35 * Math.exp(-Math.max(dist, 0) / 6);
      const glint = rim * (Math.pow(Math.max(facing, 0), 2) * 0.9 + Math.pow(Math.max(-facing, 0), 3) * 0.45 + 0.08);
      const v = Math.min(255, Math.round(glint * 255));
      s[i] = s[i + 1] = s[i + 2] = v; s[i + 3] = 255;
    }
    xd.putImageData(id, 0, 0); xs.putImageData(is, 0, 0);
    const out = { disp: cd.toDataURL(), spec: cs.toDataURL() };
    maps.set(key, out);
    if (maps.size > 60) maps.delete(maps.keys().next().value);
    return out;
  }

  const ONLY = (c) => ["1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"][c];
  const DISPERSION = [1, 1.045, 1.09]; // red bends least, blue most
  let next = 0;
  const glass = new WeakMap(); // element → { filter, displacers, scale, bulge }

  function build(el) {
    const b = el.getBoundingClientRect(); const w = Math.round(b.width), h = Math.round(b.height);
    if (w < 8 || h < 8 || w * h > 1_500_000) return; // tiny, or too big to draw quickly
    const css = getComputedStyle(el);
    const r = Math.min(parseFloat(css.borderTopLeftRadius) || 0, w / 2, h / 2);
    const edge = Math.min(36, Math.max(10, Math.min(w, h) * 0.36));
    const frost = parseFloat(css.getPropertyValue("--frost")) || 1.5;
    const { disp, spec } = drawMaps(w, h, r, edge);
    let g = glass.get(el);
    if (!g) {
      const f = document.createElementNS(NS, "filter");
      f.id = `lg${++next}`;
      defs.append(f);
      g = { filter: f, displacers: [], scale: 0, bulge: 1 };
      glass.set(el, g);
    }
    g.scale = edge * 1.25;
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) g.filter.setAttribute(k, v);
    g.filter.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${frost}" edgeMode="duplicate" result="frost"/>
      <feImage href="${disp}" x="0" y="0" width="${w}" height="${h}" result="map"/>
      ${[0, 1, 2].map((c) => `<feDisplacementMap in="frost" in2="map" scale="${(g.scale * g.bulge * DISPERSION[c]).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/><feColorMatrix in="d${c}" type="matrix" values="${ONLY(c)}" result="c${c}"/>`).join("")}
      <feBlend in="c0" in2="c1" mode="screen" result="rg"/><feBlend in="rg" in2="c2" mode="screen" result="rgb"/>
      <feImage href="${spec}" x="0" y="0" width="${w}" height="${h}" result="light"/>
      <feBlend in="light" in2="rgb" mode="screen"/>`;
    g.displacers = [...g.filter.querySelectorAll("feDisplacementMap")];
    el.style.setProperty("--lens", `url(#${g.filter.id})`);
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
      g.displacers.forEach((n, c) => n.setAttribute("scale", (g.scale * g.bulge * DISPERSION[c]).toFixed(1)));
      if (Math.abs(v) < 0.002 && Math.abs(g.target - g.bulge) < 0.002) { g.anim = 0; return; }
      g.anim = requestAnimationFrame(step);
    };
    g.anim = requestAnimationFrame(step);
  }

  const chrome = CSS.supports("backdrop-filter", "url(#x)") && /Chrome\//.test(navigator.userAgent) && !matchMedia("(prefers-reduced-transparency: reduce)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const ro = new ResizeObserver((items) => items.forEach((i) => build(i.target)));
  const watch = (root) => root.querySelectorAll?.(GLASS).forEach((el) => { if (!el.dataset.lg) { el.dataset.lg = "1"; ro.observe(el); build(el); } });
  if (chrome) {
    watch(document);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.(GLASS) ? watch(n.parentNode) : watch(n))))).observe(document.body, { childList: true, subtree: true });
    let pressed = null;
    document.addEventListener("pointerdown", (e) => { pressed = e.target.closest?.(GLASS); if (pressed) bulge(pressed, 1.7); });
    const release = () => { if (pressed) bulge(pressed, 1); pressed = null; };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
  }
  // The light on the glass follows the pointer.
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(`${GLASS},.btn`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  });
})();
