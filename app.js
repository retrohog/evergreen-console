/* ============================================================================
   THE DAILY BIAS · INVESTIGATION CONSOLE  v4
   dual theme (cyberpunk / evergreen) · SSE push · new visualisation set
   data: /api/{state,structure,edge,flow,case,series} · /api/stream (SSE)
   ============================================================================ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (v, d = 2) => v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const age = m => m == null ? "—" : m < 1 ? "now" : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
const hms = s => s == null ? "—" : s < 60 ? `${Math.max(0, Math.round(s))}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`;
const biasCls = b => String(b || "").toLowerCase().startsWith("s") ? "short" : "long";
const gradeCls = g => ({ "A+": "gAplus", "A": "gA", "B+": "gBplus", "B": "gBplus", "C": "gC" }[g] || "gC");
const rCol = r => r == null ? "var(--dim)" : r > 0 ? "var(--acc-2)" : r < 0 ? "var(--bad)" : "var(--dim)";
const confCls = c => c >= 75 ? "" : c >= 45 ? "mid" : "low";
const TF_LABEL = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1H", "240": "4H", "D": "1D" };
const PAGES = ["command", "case", "structure", "edge", "journal", "flow", "system"];
const SERIES_URL = (k, n = 180) => `/api/series?key=${k}&tf=5&n=${n}`;
const D = { state: null, structure: null, edge: null, flow: null, case: null, series: {}, page: "command", last: {}, conn: "boot", topics: [], pushAge: 0, lastFetch: 0 };
const S_ = { renders: 0, tapeWrites: 0, refetch: 0, pushes: 0, draws: 0, drawErr: 0 };   // instrumentation, surfaced in the footer
globalThis.__stats = S_;                 // also read by tests/domcheck.mjs

/* ---------------------------------------------------------------- theme */
function setTheme(t, announce = true) {
  t = t === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("desk-theme", t); } catch (e) { }
  const lab = $("#themelab"); if (lab) lab.textContent = t;
  drawAll();                                  // canvas colours come from CSS vars → repaint
  if (announce) toast(t === "dark" ? "◈ cyberpunk terminal online" : "◈ evergreen mode restored");
}
function toast(msg) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div"); el.id = "toast";
    el.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:400;" +
      "padding:9px 16px;border:1px solid var(--acc);background:var(--card);color:var(--acc);" +
      "font:600 10.5px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;pointer-events:none;" +
      "box-shadow:var(--sh-2);transition:opacity .3s,transform .3s";
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = 1; el.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; el.style.transform = "translateX(-50%) translateY(8px)"; }, 1600);
}
const theme = () => document.documentElement.dataset.theme;

/* ---------------------------------------------------------------- anim */
function flash(root = document) {
  root.querySelectorAll("[data-k]").forEach(el => {
    const k = el.dataset.k, v = el.dataset.v ?? el.textContent.trim();
    const prev = D.last[k];
    if (prev !== undefined && prev !== v) {
      el.classList.remove("flash-up", "flash-down"); void el.offsetWidth;
      const num = parseFloat(String(v).replace(/[^0-9.\-]/g, "")), pn = parseFloat(String(prev).replace(/[^0-9.\-]/g, ""));
      el.classList.add(!isNaN(num) && !isNaN(pn) && num < pn ? "flash-down" : "flash-up");
    }
    D.last[k] = v;
  });
}
function countUp(el, to, dec = 0) {
  const from = parseFloat(String(el.textContent).replace(/[^0-9.\-]/g, "")) || 0;
  if (from === to) { el.textContent = dec ? nf(to, dec) : to.toLocaleString(); return; }
  const t0 = performance.now(), dur = 420;
  const step = t => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = dec ? nf(from + (to - from) * e, dec) : Math.round(from + (to - from) * e).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/* magnetic tilt + sheen */
function magnetize(root = document) {
  root.querySelectorAll(".tile.magnet:not([data-mag])").forEach(el => {
    el.dataset.mag = "1";
    el.addEventListener("mousemove", e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (y * 100).toFixed(1) + "%");
      el.style.transform = `perspective(700px) rotateY(${(x - .5) * 5}deg) rotateX(${-(y - .5) * 5}deg) translateY(-2px)`;
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  });
}
/* ripple on every .btn */
function wireButtons(root = document) {
  root.querySelectorAll(".btn:not([data-btn])").forEach(b => {
    b.dataset.btn = "1";
    b.addEventListener("click", e => {
      const r = b.getBoundingClientRect(), s = document.createElement("span");
      s.className = "rip";
      s.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:14px;height:14px`;
      b.appendChild(s);
      setTimeout(() => s.remove(), 620);
    });
  });
}

/* ---------------------------------------------------------------- canvas utils */
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const T = () => ({
  ink: cssVar("--ink"), dim: cssVar("--dim"), faint: cssVar("--faint"), acc: cssVar("--acc"), acc2: cssVar("--acc-2"),
  alt: cssVar("--alt"), warn: cssVar("--warn"), bad: cssVar("--bad"), violet: cssVar("--violet"),
  line: cssVar("--line"), card: cssVar("--card"), grid: cssVar("--grid"),
});
function hidpi(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, w: r.width, h: r.height };
}
const TIP = () => { let t = $("#tip"); if (!t) { t = document.createElement("div"); t.id = "tip"; t.className = "tip"; document.body.appendChild(t); } return t; };
function bindTip(cv, hit) {
  const tip = TIP();
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect(), info = hit(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (!info) { tip.style.opacity = 0; return; }
    tip.innerHTML = info; tip.style.opacity = 1;
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 12, e.clientX + 14) + "px";
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 12) + "px";
  };
  cv.onmouseleave = () => tip.style.opacity = 0;
}
function gridlines(x, w, h, pad, n = 4) {
  const t = T(); x.strokeStyle = t.line; x.lineWidth = 1;
  for (let i = 0; i <= n; i++) { const y = pad.t + (h - pad.t - pad.b) * i / n; x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); }
}
const DRAWS = [];                                    // canvas repaint registry (theme switch / resize)
const onDraw = fn => DRAWS.push(fn);
function drawAll() { requestAnimationFrame(() => render()); }

/* ---------------------------------------------------------------- charts */
function lineChart(cv, pts, { key = "cum", color = null, fill = true, yFmt = v => nf(v, 1), lbl = p => String(p.when || "").slice(5, 10) } = {}) {
  const t = T(); color = color || t.acc;
  const { x, w, h } = hidpi(cv), pad = { l: 46, r: 16, t: 12, b: 20 };
  const vals = pts.map(p => p[key]);
  if (vals.length < 2) { x.fillStyle = t.faint; x.font = "11px ui-monospace,monospace"; x.fillText("not enough data yet", pad.l, h / 2); return; }
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals) || 1;
  const X = i => pad.l + i * (w - pad.l - pad.r) / (vals.length - 1);
  const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
  gridlines(x, w, h, pad);
  x.font = "9px ui-monospace,monospace"; x.fillStyle = t.dim; x.textAlign = "right";
  [0, .25, .5, .75, 1].forEach(f => x.fillText(yFmt(lo + (hi - lo) * f), pad.l - 7, Y(lo + (hi - lo) * f) + 3));
  if (lo < 0) { x.strokeStyle = t.line; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(pad.l, Y(0)); x.lineTo(w - pad.r, Y(0)); x.stroke(); x.setLineDash([]); }
  if (fill) {
    const g = x.createLinearGradient(0, pad.t, 0, h - pad.b);
    g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
    x.beginPath(); vals.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
    x.lineTo(X(vals.length - 1), h - pad.b); x.lineTo(X(0), h - pad.b); x.closePath(); x.fillStyle = g; x.fill();
  }
  const stroke = x.createLinearGradient(pad.l, 0, w - pad.r, 0);
  stroke.addColorStop(0, color); stroke.addColorStop(1, t.alt);
  x.beginPath(); vals.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
  x.strokeStyle = stroke; x.lineWidth = 1.9; x.lineJoin = "round"; x.stroke();
  x.textAlign = "center"; x.fillStyle = t.faint;
  const step = Math.max(1, Math.ceil(vals.length / 8));
  pts.forEach((p, i) => { if (i % step === 0) x.fillText(lbl(p), X(i), h - 4); });
  bindTip(cv, mx => {
    const i = Math.round((mx - pad.l) / ((w - pad.l - pad.r) / (vals.length - 1 || 1)));
    if (i < 0 || i >= pts.length) return null;
    const p = pts[i];
    return `<b>${esc(p.when || "")}</b><br>${yFmt(p[key])}${p.r != null ? ` · ${nf(p.r, 2)}R` : ""}${p.key ? `<br>${esc(String(p.key).toUpperCase())} ${esc(p.kind || "")}` : ""}`;
  });
}
function barChart(cv, bars, { fmt = v => nf(v, 0), density = null } = {}) {
  const t = T();
  const { x, w, h } = hidpi(cv), pad = { l: 12, r: 12, t: 14, b: 22 };
  const max = Math.max(1, ...bars.map(b => Math.abs(b.v)));
  const bw = (w - pad.l - pad.r) / bars.length;
  gridlines(x, w, h, pad, 3);
  bars.forEach((b, i) => {
    const bh = (h - pad.t - pad.b) * (Math.abs(b.v) / max);
    const bx = pad.l + i * bw + bw * .18, by = h - pad.b - bh;
    const c = b.c || (b.v >= 0 ? t.acc : t.bad);
    const g = x.createLinearGradient(0, by, 0, h - pad.b); g.addColorStop(0, c); g.addColorStop(1, c + "44");
    x.fillStyle = g; x.fillRect(bx, by, bw * .64, Math.max(1, bh));
    x.fillStyle = t.ink; x.font = "9.5px ui-monospace,monospace"; x.textAlign = "center";
    x.fillText(fmt(b.v), bx + bw * .32, by - 4);
    x.fillStyle = t.faint; x.fillText(b.k, bx + bw * .32, h - 7);
  });
  if (density && density.length > 2) {                       // gaussian-density overlay
    const dmax = Math.max(...density);
    x.beginPath();
    density.forEach((d, i) => {
      const px = pad.l + (i / (density.length - 1)) * (w - pad.l - pad.r);
      const py = h - pad.b - (d / dmax) * (h - pad.t - pad.b) * .92;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.strokeStyle = t.alt; x.lineWidth = 1.6; x.setLineDash([5, 4]); x.stroke(); x.setLineDash([]);
  }
  bindTip(cv, mx => { const i = Math.floor((mx - pad.l) / bw); return (i < 0 || i >= bars.length) ? null : `<b>${esc(bars[i].k)}</b><br>${esc(bars[i].tip || fmt(bars[i].v))}`; });
}
function scatterChart(cv, pts) {
  const t = T();
  const { x, w, h } = hidpi(cv), pad = { l: 40, r: 14, t: 14, b: 26 };
  const xs = pts.map(p => p.mae).filter(v => v != null), ys = pts.map(p => p.mfe).filter(v => v != null);
  if (!xs.length) return;
  const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
  const X = v => pad.l + (w - pad.l - pad.r) * ((v - xlo) / ((xhi - xlo) || 1));
  const Y = v => h - pad.b - (h - pad.t - pad.b) * ((v - ylo) / ((yhi - ylo) || 1));
  gridlines(x, w, h, pad);
  x.strokeStyle = t.line; x.setLineDash([4, 4]);
  x.beginPath(); x.moveTo(X(1), pad.t); x.lineTo(X(1), h - pad.b); x.stroke();
  x.beginPath(); x.moveTo(pad.l, Y(1)); x.lineTo(w - pad.r, Y(1)); x.stroke(); x.setLineDash([]);
  x.fillStyle = t.dim; x.font = "9px ui-monospace,monospace"; x.textAlign = "left"; x.fillText("MFE (R)", 6, 12);
  x.textAlign = "right"; x.fillText("MAE (R)", w - 8, h - 8);
  pts.forEach(p => {
    if (p.mae == null || p.mfe == null) return;
    x.beginPath(); x.arc(X(p.mae), Y(p.mfe), 2.6 + Math.min(4.4, Math.abs(p.r || 0)), 0, 7);
    x.fillStyle = (p.r || 0) > 0 ? t.acc + "B0" : t.bad + "B0"; x.fill();
    x.strokeStyle = t.card; x.lineWidth = 1; x.stroke();
  });
  bindTip(cv, (mx, my) => {
    let best = null, bd = 1e9;
    pts.forEach(p => { if (p.mae == null) return; const d = (X(p.mae) - mx) ** 2 + (Y(p.mfe) - my) ** 2; if (d < bd) { bd = d; best = p; } });
    return (!best || bd > 340) ? null : `<b>${esc(best.when)}</b><br>${esc(String(best.key).toUpperCase())} ${esc(best.kind)} ${esc(best.grade)}<br>R ${nf(best.r, 2)} · MFE ${nf(best.mfe, 2)} · MAE ${nf(best.mae, 2)}`;
  });
}
function candles(cv, bars, zones = [], spot = null) {
  const t = T();
  const { x, w, h } = hidpi(cv), pad = { l: 8, r: 62, t: 10, b: 16 };
  if (!bars || bars.length < 3) return;
  const lo = Math.min(...bars.map(b => b[3])), hi = Math.max(...bars.map(b => b[2]));
  const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / ((hi - lo) || 1));
  const bw = (w - pad.l - pad.r) / bars.length, X = i => pad.l + i * bw + bw / 2;
  gridlines(x, w, h, pad, 3);
  zones.filter(z => z.top != null).forEach(z => {
    const top = Y(Math.max(z.top, z.bot)), bot = Y(Math.min(z.top, z.bot));
    x.fillStyle = (z.dir === "bull" ? t.acc : t.bad) + "26";
    x.fillRect(pad.l, top, w - pad.l - pad.r, Math.max(1, bot - top));
  });
  bars.forEach((b, i) => {
    const up = b[4] >= b[1];
    x.strokeStyle = up ? t.acc : t.bad;
    x.fillStyle = (up ? t.acc : t.bad) + "8C";
    x.beginPath(); x.moveTo(X(i), Y(b[2])); x.lineTo(X(i), Y(b[3])); x.stroke();
    const yo = Y(Math.max(b[1], b[4])), yc = Y(Math.min(b[1], b[4]));
    x.fillRect(X(i) - Math.max(1, bw * .3), yo, Math.max(2, bw * .6), Math.max(1, yc - yo));
  });
  if (spot != null) {
    x.strokeStyle = t.ink; x.setLineDash([5, 4]); x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(pad.l, Y(spot)); x.lineTo(w - pad.r, Y(spot)); x.stroke(); x.setLineDash([]);
    x.fillStyle = t.ink; x.font = "600 10px ui-monospace,monospace"; x.textAlign = "left";
    x.fillText(`◆ ${nf(spot, 1)}`, w - pad.r + 5, Y(spot) + 3);
  }
  x.fillStyle = t.faint; x.font = "9px ui-monospace,monospace"; x.textAlign = "right";
  [hi, (hi + lo) / 2, lo].forEach((v, i) => x.fillText(nf(v, 1), w - pad.r - 2, Y(v) + (i === 0 ? 10 : i === 2 ? -3 : 3)));
  bindTip(cv, (mx) => {
    const i = Math.floor((mx - pad.l) / bw); if (i < 0 || i >= bars.length) return null;
    const b = bars[i];
    return `<b>${new Date(b[0] * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b><br>O ${nf(b[1], 1)} H ${nf(b[2], 1)}<br>L ${nf(b[3], 1)} C ${nf(b[4], 1)}<br>vol ${b[5]}`;
  });
}
function sparkline(cv, closes, color = null) {
  const t = T(); color = color || t.acc;
  const { x, w, h } = hidpi(cv);
  if (!closes || closes.length < 3) return;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const X = i => (i / (closes.length - 1)) * w, Y = v => h - ((v - lo) / ((hi - lo) || 1)) * (h - 6) - 3;
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
  x.beginPath(); closes.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
  x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fillStyle = g; x.fill();
  x.beginPath(); closes.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)));
  x.strokeStyle = color; x.lineWidth = 1.4; x.stroke();
  const lx = X(closes.length - 1), ly = Y(closes[closes.length - 1]);
  x.beginPath(); x.arc(lx - 2, ly, 2.6, 0, 7); x.fillStyle = color; x.fill();
}
/* ---- RADAR: multi-axis quality polygon (case file) ---- */
function radar(cv, axes, { threshold = 55 } = {}) {
  const t = T();
  const { x, w, h } = hidpi(cv);
  const cx = w / 2, cy = h / 2 + 4, R = Math.max(30, Math.min(w, h) / 2 - 26);
  const n = axes.length, ang = i => (Math.PI * 2 * i / n) - Math.PI / 2;
  const P = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
  [.25, .5, .75, 1].forEach(f => {
    x.beginPath();
    for (let i = 0; i <= n; i++) { const [px, py] = P(i % n, f); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.strokeStyle = t.line; x.lineWidth = 1; x.stroke();
  });
  for (let i = 0; i < n; i++) { const [px, py] = P(i, 1); x.beginPath(); x.moveTo(cx, cy); x.lineTo(px, py); x.strokeStyle = t.grid; x.stroke(); }
  x.beginPath();
  axes.forEach((a, i) => { const [px, py] = P(i, Math.max(.04, a.v / 100)); i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.closePath();
  const g = x.createRadialGradient(cx, cy, 4, cx, cy, R);
  g.addColorStop(0, t.acc + "66"); g.addColorStop(1, t.alt + "18");
  x.fillStyle = g; x.fill();
  x.strokeStyle = t.acc; x.lineWidth = 2; x.stroke();
  // threshold ghost
  x.beginPath();
  axes.forEach((a, i) => { const [px, py] = P(i, threshold / 100); i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.closePath(); x.setLineDash([4, 4]); x.strokeStyle = t.warn; x.lineWidth = 1; x.stroke(); x.setLineDash([]);
  axes.forEach((a, i) => {
    const [px, py] = P(i, Math.max(.04, a.v / 100));
    x.beginPath(); x.arc(px, py, 3.2, 0, 7); x.fillStyle = t.acc; x.fill();
    const [lx, ly] = P(i, 1.16);
    x.fillStyle = t.dim; x.font = "9px ui-monospace,monospace";
    x.textAlign = Math.abs(lx - cx) < 12 ? "center" : lx > cx ? "left" : "right";
    x.fillText(a.k.toUpperCase(), lx, ly); x.fillStyle = t.acc; x.fillText(a.v + "%", lx, ly + 10);
  });
  bindTip(cv, (mx, my) => {
    let best = null, bd = 1e9;
    axes.forEach((a, i) => { const [px, py] = P(i, Math.max(.04, a.v / 100)); const d = (px - mx) ** 2 + (py - my) ** 2; if (d < bd) { bd = d; best = a; } });
    return (!best || bd > 900) ? null : `<b>${esc(best.k)}</b><br>${best.v}% confidence${best.src ? `<br>${esc(best.src).slice(0, 90)}` : ""}`;
  });
}
/* ---- POLAR CLOCK: R by hour of day (edge lab) ---- */
function polarClock(cv, hours) {
  const t = T();
  const { x, w, h } = hidpi(cv);
  const cx = w / 2, cy = h / 2, R = Math.max(30, Math.min(w, h) / 2 - 18);
  const byHour = {}; hours.forEach(o => byHour[o.h] = o);
  const maxAbs = Math.max(1, ...hours.map(o => Math.abs(o.sum)));
  [.33, .66, 1].forEach(f => { x.beginPath(); x.arc(cx, cy, R * f, 0, 7); x.strokeStyle = t.line; x.stroke(); });
  for (let hh = 0; hh < 24; hh++) {
    const a0 = (hh / 24) * Math.PI * 2 - Math.PI / 2, a1 = ((hh + 0.82) / 24) * Math.PI * 2 - Math.PI / 2;
    const o = byHour[hh];
    const r = o ? Math.max(.12, Math.abs(o.sum) / maxAbs) : .1;
    x.beginPath(); x.moveTo(cx, cy);
    x.arc(cx, cy, R * r, a0, a1); x.closePath();
    x.fillStyle = !o ? t.line : o.sum > 0 ? t.acc + "D0" : t.bad + "D0";
    x.fill();
  }
  for (let hh = 0; hh < 24; hh += 3) {
    const a = (hh / 24) * Math.PI * 2 - Math.PI / 2;
    x.fillStyle = t.faint; x.font = "8.5px ui-monospace,monospace"; x.textAlign = "center";
    x.fillText(String(hh).padStart(2, "0"), cx + Math.cos(a) * (R + 11), cy + Math.sin(a) * (R + 11) + 3);
  }
  const best = hours.slice().sort((a, b) => b.sum - a.sum)[0], worst = hours.slice().sort((a, b) => a.sum - b.sum)[0];
  x.textAlign = "center"; x.fillStyle = t.acc; x.font = "600 11px ui-monospace,monospace";
  x.fillText(best ? `+${nf(best.sum, 1)}R ${String(best.h).padStart(2, "0")}h` : "—", cx, cy - 4);
  x.fillStyle = t.bad; x.fillText(worst ? `${nf(worst.sum, 1)}R ${String(worst.h).padStart(2, "0")}h` : "—", cx, cy + 10);
  bindTip(cv, (mx, my) => {
    const dx = mx - cx, dy = my - cy, dist = Math.hypot(dx, dy);
    if (dist > R + 14) return null;
    let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
    const hh = Math.floor((a / (Math.PI * 2)) * 24) % 24, o = byHour[hh];
    return `<b>${String(hh).padStart(2, "0")}:00</b><br>${o ? `${o.n} trades · Σ ${nf(o.sum, 2)}R · avg ${nf(o.avg, 2)}R` : "no trades"}`;
  });
}
/* ---- TREEMAP: desk churn by size (system) ---- */
function treemap(cv, items) {
  const t = T();
  const { x, w, h } = hidpi(cv);
  if (!items.length) return;
  const data = items.slice().sort((a, b) => b.kb - a.kb);
  const total = data.reduce((s, d) => s + d.kb, 0) || 1;
  let free = { x: 0, y: 0, w, h }, i = 0;
  const rects = [];
  while (i < data.length) {
    const horiz = free.w >= free.h;
    const side = horiz ? free.h : free.w;
    let row = [], rowW = 0, area = 0;
    while (i < data.length) {
      const a = (data[i].kb / total) * w * h;
      const need = horiz ? (rowW + area + a) / side : (rowW + area + a) / side;
      if (row.length && need > (horiz ? free.w : free.h)) break;
      row.push(data[i]); area += a; rowW = area / side; i++;
    }
    const thickness = Math.min(horiz ? free.w : free.h, rowW || 1);
    let off = 0;
    row.forEach(d => {
      const seg = (d.kb / total) * w * h / (thickness || 1);
      const r = horiz ? { x: free.x, y: free.y + off, w: thickness, h: seg }
        : { x: free.x + off, y: free.y, w: seg, h: thickness };
      rects.push({ ...r, d }); off += seg;
    });
    if (horiz) { free = { x: free.x + thickness, y: free.y, w: Math.max(0, free.w - thickness), h: free.h }; }
    else { free = { x: free.x, y: free.y + thickness, w: free.w, h: Math.max(0, free.h - thickness) }; }
    if (!free.w || !free.h) break;
  }
  rects.forEach(({ x: rx, y: ry, w: rw, h: rh, d }) => {
    const stale = d.age_min > 240;
    x.fillStyle = stale ? t.warn + "3A" : t.acc + "2E";
    x.fillRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
    x.strokeStyle = stale ? t.warn : t.acc; x.lineWidth = 1;
    x.strokeRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
    if (rw > 62 && rh > 26) {
      x.fillStyle = t.ink; x.font = "600 9.5px ui-monospace,monospace"; x.textAlign = "left";
      x.fillText(d.name.slice(0, Math.floor(rw / 6.2)), rx + 6, ry + 14);
      x.fillStyle = t.dim; x.font = "9px ui-monospace,monospace";
      x.fillText(`${nf(d.kb, 1)}kb · ${age(d.age_min)}`, rx + 6, ry + 26);
    }
  });
  bindTip(cv, (mx, my) => {
    const hit = rects.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
    return hit ? `<b>${esc(hit.d.name)}</b><br>${nf(hit.d.kb, 1)}kb · touched ${age(hit.d.age_min)} ago` : null;
  });
}
/* ---- RADIAL ZONES: ATR rings + zone arcs (structure) ---- */
function radialZones(cv, inst) {
  const t = T();
  const { x, w, h } = hidpi(cv);
  const cx = w / 2, cy = h / 2, R = Math.max(40, Math.min(w, h) / 2 - 22);
  const atr = ((inst.tfs || []).find(f => f.tf === "5") || {}).atr || 1;
  const spot = inst.spot;
  const zones = (inst.zones || []).filter(z => z.top != null);
  const maxAtr = Math.max(2.2, ...zones.map(z => Math.abs((z.top + z.bot) / 2 - spot) / atr));
  const rad = d => Math.min(.98, Math.abs(d) / atr / maxAtr);
  [1, 2, 3, 4].forEach(k => {
    const r = rad(k * atr * (maxAtr / 4)) * R;
    x.beginPath(); x.arc(cx, cy, Math.max(6, r), 0, 7); x.strokeStyle = t.line; x.lineWidth = 1; x.stroke();
    x.fillStyle = t.faint; x.font = "8.5px ui-monospace,monospace"; x.textAlign = "left";
    x.fillText(`${k}×ATR`, cx + Math.max(6, r) + 3, cy - 2);
  });
  const tfs = [...new Set(zones.map(z => z.tf))];
  zones.forEach(z => {
    const mid = (z.top + z.bot) / 2, dist = mid - spot, r = Math.max(.1, rad(dist)) * R;
    const idx = tfs.indexOf(z.tf), span = (Math.PI * 2) / tfs.length;
    const a0 = idx * span - span * .35, a1 = a0 + span * .7;
    const bull = z.dir === "bull";
    x.beginPath();
    x.arc(cx, cy, r + 3, a0, a1);
    x.arc(cx, cy, Math.max(2, r - 5), a1, a0, true);
    x.closePath();
    x.fillStyle = (bull ? t.acc : t.bad) + (z.state === "open" ? "8C" : "33");
    x.fill();
    x.strokeStyle = bull ? t.acc : t.bad; x.lineWidth = 1; x.stroke();
  });
  x.beginPath(); x.arc(cx, cy, 4, 0, 7); x.fillStyle = t.acc; x.fill();
  x.fillStyle = t.ink; x.font = "600 10px ui-monospace,monospace"; x.textAlign = "center";
  x.fillText(`◆ ${nf(spot, 1)}`, cx, cy + 18);
  tfs.forEach((tf, i) => {
    const a = i * (Math.PI * 2) / tfs.length;
    x.fillStyle = t.dim; x.font = "9px ui-monospace,monospace"; x.textAlign = "center";
    x.fillText(TF_LABEL[tf] || tf, cx + Math.cos(a) * (R + 12), cy + Math.sin(a) * (R + 12) + 3);
  });
  bindTip(cv, (mx, my) => {
    const dx = mx - cx, dy = my - cy, dist = Math.hypot(dx, dy);
    let best = null, bd = 1e9;
    zones.forEach(z => {
      const mid = (z.top + z.bot) / 2, r = Math.max(.1, rad(mid - spot)) * R;
      const d = Math.abs(dist - r);
      if (d < bd) { bd = d; best = z; }
    });
    return (!best || bd > 12) ? null : `<b>${TF_LABEL[best.tf]} ${best.kind} ${best.dir}</b><br>${nf(best.bot, 1)} – ${nf(best.top, 1)}<br>${nf(Math.abs((best.top + best.bot) / 2 - spot) / atr, 2)}×ATR from spot · ${best.state}`;
  });
}
/* ---- BULLET: value vs target rows (case / command) ---- */
function bullets(cv, rows) {
  const t = T();
  const { x, w, h } = hidpi(cv);
  const rh = h / Math.max(1, rows.length);
  rows.forEach((r, i) => {
    const y = i * rh + rh * .5;
    const max = Math.max(r.max, r.value, r.target) * 1.08 || 1;
    const bw = w - 92;
    x.fillStyle = t.line; x.fillRect(70, y - 5, bw, 10);
    x.fillStyle = (r.value >= r.target ? t.acc : t.warn) + "CC";
    x.fillRect(70, y - 5, Math.max(1, (r.value / max) * bw), 10);
    x.fillStyle = t.ink; x.fillRect(70 + (r.target / max) * bw, y - 9, 2, 18);
    x.fillStyle = t.dim; x.font = "9.5px ui-monospace,monospace"; x.textAlign = "right";
    x.fillText(r.label.toUpperCase(), 62, y + 3);
    x.textAlign = "left"; x.fillStyle = r.value >= r.target ? t.acc : t.faint;
    x.fillText(`${nf(r.value, r.dec ?? 1)} / ${nf(r.target, r.dec ?? 1)}`, w - 86 + 6, y + 3);
  });
  bindTip(cv, (mx, my) => {
    const i = Math.floor(my / rh);
    if (i < 0 || i >= rows.length) return null;
    const r = rows[i];
    return `<b>${esc(r.label)}</b><br>${nf(r.value, r.dec ?? 2)} vs target ${nf(r.target, r.dec ?? 2)}${r.note ? `<br>${esc(r.note)}` : ""}`;
  });
}
/* ---- pipeline ribbons (flow) ---- */
function ribbons(svg, steps, counts) {
  const t = T();
  const w = 900, h = 110, n = steps.length;
  const gw = w / n, maxC = Math.max(1, ...steps.map(s => counts[s.job] || 1));
  let out = `<defs><linearGradient id="rb" x1="0" x2="1">
    <stop offset="0" stop-color="${t.acc}" stop-opacity=".75"/><stop offset="1" stop-color="${t.alt}" stop-opacity=".35"/></linearGradient></defs>`;
  for (let i = 0; i < n - 1; i++) {
    const c = counts[steps[i].job] || 1;
    const th = 5 + (c / maxC) * 26;
    const x0 = i * gw + gw * .55, x1 = (i + 1) * gw + gw * .15;
    out += `<path d="M${x0},${h / 2 - th / 2} C${x0 + gw * .6},${h / 2 - th / 2} ${x1 - gw * .6},${h / 2 - th / 2} ${x1},${h / 2 - 4}"
      L${x1},${h / 2 + 4} C${x1 - gw * .6},${h / 2 + th / 2} ${x0 + gw * .6},${h / 2 + th / 2} ${x0},${h / 2 + th / 2} Z"
      fill="url(#rb)" opacity=".5" stroke="${t.acc}" stroke-width=".8"/>`;
    out += `<text x="${(x0 + x1) / 2}" y="${h / 2 - th / 2 - 5}" fill="${t.dim}" font-size="9"
      font-family="ui-monospace,monospace" text-anchor="middle">${c} run${c === 1 ? "" : "s"}</text>`;
  }
  steps.forEach((s, i) => {
    const cx = i * gw + gw * .35;
    out += `<circle cx="${cx}" cy="${h / 2}" r="6" fill="${t.card}" stroke="${t.acc}" stroke-width="1.6"/>
      <text x="${cx}" y="${h / 2 + 26}" fill="${t.dim}" font-size="9.5" font-family="ui-monospace,monospace" text-anchor="middle">${esc(s.name)}</text>`;
  });
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = out;
}
/* gaussian density of a sample (for the R histogram) */
function kde(values, buckets = 80, bw = 0.35) {
  if (!values.length) return [];
  const lo = Math.min(...values) - 1, hi = Math.max(...values) + 1, out = [];
  for (let i = 0; i < buckets; i++) {
    const xx = lo + (hi - lo) * i / (buckets - 1);
    let s = 0;
    for (const v of values) { const z = (xx - v) / bw; s += Math.exp(-.5 * z * z); }
    out.push(s / (values.length * bw * Math.sqrt(2 * Math.PI)));
  }
  return out;
}

/* ---------------------------------------------------------------- parts */
function ring(pct, label, value, sub, color = null, sweep = false) {
  const t = T(); color = color || t.acc;
  const r = 50, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<div class="ring"><svg width="124" height="124" viewBox="0 0 124 124">
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="${t.line}" stroke-width="6"/>
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .7s"/>
    ${sweep ? `<g class="sweep"><line x1="62" y1="62" x2="62" y2="12" stroke="${color}" stroke-width="2" opacity=".55"/></g>` : ""}
  </svg><div class="ctr"><b style="color:${color}">${value}</b><span>${label}</span>${sub ? `<span style="color:var(--faint)">${sub}</span>` : ""}</div></div>`;
}
function tile(lab, v, sub, cls = "", extra = "", k = "") {
  return `<div class="hud tile magnet ${cls}"><span class="sheen"></span><div class="lab">${lab}</div>
    <div class="v" data-k="${k || lab}" data-v="${esc(v)}">${v}</div><div class="sub">${sub}</div>${extra}</div>`;
}
function ladder(inst, s) {
  const pts = [];
  (s.tps || []).forEach(t => t.price != null && pts.push(t.price));
  [s.stop, s.entry, inst.spot].forEach(p => p != null && pts.push(p));
  if (s.zone) s.zone.forEach(p => pts.push(p));
  if (pts.length < 2) return "";
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = (hi - lo) * .07 || 1; lo -= pad; hi += pad;
  const pos = p => ((hi - p) / (hi - lo) * 100).toFixed(2);
  const bull = String(s.bias || "").toLowerCase().startsWith("l");
  let h = '<div class="ladder"><div class="lbar">';
  if (s.zone) { const a = Math.min(...s.zone), b = Math.max(...s.zone);
    h += `<div class="zone ${bull ? "bull" : ""}" style="left:${Math.min(pos(a), pos(b))}%;width:${Math.max(.6, Math.abs(pos(b) - pos(a))).toFixed(2)}%"></div>`; }
  if (s.stop != null) h += `<div class="lv stop" style="left:${pos(s.stop)}%"><i style="bottom:3px">SL ${nf(s.stop, 1)}</i></div>`;
  if (s.entry != null) h += `<div class="lv entry" style="left:${pos(s.entry)}%"><i style="top:3px">E ${nf(s.entry, 1)}</i></div>`;
  (s.tps || []).forEach((t, i) => { if (t.price == null) return;
    h += `<div class="lv tp" style="left:${pos(t.price)}%"><i style="top:${18 + i * 10}px">TP${i + 1} ${nf(t.price, 1)}${t.r != null ? ` · ${nf(t.r, 1)}R` : ""}</i></div>`; });
  if (inst.spot != null) h += `<div class="mk" style="left:${pos(inst.spot)}%">◆ ${nf(inst.spot, 1)}</div>`;
  return h + `</div><div class="scale"><span>${nf(hi, 1)}</span><span class="k">spot vs POI vs targets</span><span>${nf(lo, 1)}</span></div></div>`;
}
function structMap(inst) {
  const zs = (inst.zones || []).filter(z => z.top != null && z.bot != null);
  if (!zs.length) return '<div class="empty">no zones in report</div>';
  const prices = [];
  zs.forEach(z => prices.push(z.top, z.bot));
  if (inst.spot != null) prices.push(inst.spot);
  const vpc = (inst.vp || {}).vp_current;
  if (vpc) prices.push(vpc.hi, vpc.lo);
  let lo0 = Math.min(...prices), hi0 = Math.max(...prices);
  const span0 = (hi0 - lo0) || 1;
  const near = v => v != null && v >= lo0 - span0 * .55 && v <= hi0 + span0 * .55;
  Object.values(inst.vp || {}).forEach(v => [v.poc, v.vah, v.val].forEach(p => near(p) && prices.push(p)));
  (inst.sessions || []).forEach(s => [s.high, s.low, s.rth_high, s.rth_low].forEach(p => near(p) && prices.push(p)));
  (inst.clusters || []).forEach(c => near(c.avg) && prices.push(c.avg));
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = (hi - lo) * .04; lo -= pad; hi += pad;
  const y = p => ((hi - p) / (hi - lo) * 100).toFixed(2);
  const tfs = [...new Set(zs.map(z => z.tf))];
  const colW = 100 / (tfs.length + 1.25);
  let h = `<div class="structmap">`;
  for (let i = 0; i <= 8; i++) h += `<div class="gl" style="top:${i * 11.5 + 3}%"></div>`;
  tfs.forEach((tf, i) => {
    const x = 6 + i * colW;
    h += `<div class="col" style="left:${x - 2}%"></div><div class="colhead" style="left:${x + colW * .34}%">${TF_LABEL[tf] || tf}</div>`;
    zs.filter(z => z.tf === tf).forEach(z => {
      const top = y(Math.max(z.top, z.bot)), bot = y(Math.min(z.top, z.bot));
      const bull = z.dir === "bull", mit = z.state && z.state !== "open";
      const c = bull ? "62,142,92" : "180,70,47";
      h += `<div class="blk" title="${TF_LABEL[tf]} ${z.kind} ${z.dir} ${nf(z.bot, 1)}–${nf(z.top, 1)} · ${z.state}${z.age != null ? " · age " + z.age : ""}"
        style="left:${x}%;width:${colW * .72}%;top:${top}%;height:${Math.max(.6, bot - top)}%;
        background:linear-gradient(180deg,rgba(${c},.4),rgba(${c},.14));border-color:rgba(${c},${mit ? .3 : .8});
        ${z.kind === "FVG" ? "border-style:dashed;" : ""}${mit ? "opacity:.45;" : ""}"></div>`;
    });
  });
  const vpp = (inst.vp || {}).vp_prior, vpcomp = (inst.vp || {}).vp_composite;
  const line = (p, color, lab, dash) => p == null ? "" :
    `<div class="lvl" style="top:${y(p)}%;background:${color};${dash ? "opacity:.8;" : ""}"><i style="color:${color}">${esc(lab)} ${nf(p, 1)}</i></div>`;
  h += line(vpcomp && vpcomp.poc, "var(--violet)", "comp POC", 1);
  h += line(vpp && vpp.poc, "var(--faint)", "prior POC", 1);
  h += line(vpc && vpc.vah, "var(--warn)", "VAH", 1);
  h += line(vpc && vpc.poc, "var(--warn)", "POC", 0);
  h += line(vpc && vpc.val, "var(--warn)", "VAL", 1);
  (inst.clusters || []).slice(0, 5).forEach(c => { h += line(c.avg, "var(--alt)", "◆" + c.score, 1); });
  h += `<div class="now" style="top:${y(inst.spot)}%"><i>◆ ${nf(inst.spot, 1)}</i></div>`;
  for (let i = 0; i <= 6; i++) h += `<div class="px" style="top:${(i / 6) * 100}%">${nf(hi - (hi - lo) * i / 6, 1)}</div>`;
  return h + `</div><div class="legend">
    <span><s style="background:var(--bad)"></s>bearish zone</span>
    <span><s style="background:var(--acc)"></s>bullish zone</span>
    <span><s style="background:var(--warn)"></s>session VP</span>
    <span><s style="background:var(--violet)"></s>composite POC</span>
    <span><s style="background:var(--alt)"></s>confluence cluster</span>
    <span>dashed = FVG · faded = mitigated</span></div>`;
}
const leds = arr => `<span class="leds">${arr.map(r => `<span class="led ${r === "completed" ? "ok" : r === "running" ? "run" : r ? "bad" : ""}" title="${esc(r || "no data")}"></span>`).join("")}</span>`;

/* ============================================================ 01 COMMAND */
function pCommand() {
  const S = D.state; if (!S) return;
  const c = S.calls.stats || {}, p = S.paper, pu = S.pulse, sess = S.session;
  const nxt = (S.crons || []).find(x => x.next_in_s != null);
  const hot = !!sess.killzone;
  const hr = (S.et || "00:00:00").slice(0, 2) * 1 + (S.et || "00:00").slice(3, 5) / 60;
  const cur = hr >= 20 ? hr : hr + 24;
  const kzProg = hot ? (sess.killzone === "Asia" ? (cur - 20) / 6 : (hr - 9.5) / 4) : 0;
  const nextEv = (S.econ || [])[0];
  const mgc = (D.series.mgc || {}).bars || [], nq = (D.series.nq || {}).bars || [];
  const closes = b => b.map(r => r[4]);
  const best = ((S.playbook || [])[0] || {}).setups?.[0] || {};

  $("#p-command").innerHTML = `
  <div class="hero">
    <div class="hud tile magnet" style="grid-column:span 2"><span class="sheen"></span>
      <div class="lab">market state · ${esc(S.ist_date)}</div>
      <div class="v" style="font-size:26px" data-k="mkt" data-v="${esc(sess.market + sess.label)}">${esc(sess.market)} <small>${esc(sess.label)}</small></div>
      <div class="sub">${hot ? "killzone live — scanner armed" : "outside killzone — watching only"}</div>
      <div class="tick" id="streamchip2">—</div>
    </div>
    ${tile("desk calls", c.count ?? 0, `${c.a_grade ?? 0} at A-grade · ${esc(S.calls.day || "—")}`, "", "", "calls")}
    ${tile("open · pending", c.pending ?? 0, `${c.win ?? 0}W / ${c.loss ?? 0}L / ${c.missed ?? 0} missed`, "", "", "pending")}
    ${tile("paper R", nf(p.cum_r, 2), `${p.resolved} resolved`, "", "", "paperR")}
    ${tile("hit rate", p.win_rate == null ? "—" : p.win_rate + "%", "paper stream", "teal", "", "hitrate")}
    ${tile("next job", nxt ? hms(nxt.next_in_s) : "—", esc(nxt ? nxt.name : ""), "", "", "nextjob")}
    ${tile("spend today", (pu.tokens_today || 0).toLocaleString(), `${pu.runs_today ?? 0} runs`, "plum", "", "tokens")}
    ${tile("next release", nextEv ? nextEv.in_min + "m" : "—", nextEv ? esc(nextEv.title) : "no calendar", "sun", "", "nextev")}
    ${tile("heartbeat", pu.heartbeat_age_s == null ? "—" : hms(pu.heartbeat_age_s), beatWord(pu.heartbeat_age_s), pu.heartbeat_age_s < 180 ? "" : "clay", "", "beat")}
  </div>
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Playbook <em>live zones · ${age(S.files["playbook.json"])} old</em></h2><div class="pad" id="pb"></div></div>
      <div class="hud"><h2>Confluence clusters <em>report scan</em></h2><div class="pad" id="cl"></div></div>
    </div>
    <div class="stack">
      <div class="hud"><h2>Session clocks</h2><div class="pad ringrow">
        ${ring(kzProg, hot ? sess.killzone + " killzone" : "killzone", hot ? Math.round(kzProg * 100) + "%" : "off", hot ? "elapsed" : "next 20:00 ET", hot ? cssVar("--bad") : cssVar("--faint"), hot)}
        ${ring(nxt && nxt.next_in_s != null ? 1 - Math.min(1, nxt.next_in_s / 1800) : 0, "next cron", nxt ? hms(nxt.next_in_s) : "—", esc(nxt ? nxt.name : ""), cssVar("--alt"))}
        ${ring((S.et || "").slice(6, 8) / 60, "ET minute", (S.et || "").slice(0, 5), "logic clock", cssVar("--warn"))}
      </div></div>
      <div class="hud"><h2>Target ladder <em>R multiple vs 2R minimum</em></h2><div class="pad">
        <div class="chart" style="height:96px"><canvas id="cv-bul"></canvas></div></div></div>
      <div class="hud"><h2>Instrument pulse <em>5m · ${mgc.length} bars</em></h2><div class="pad">
        <div class="k">${esc((D.structure?.[0]?.name) || "MGC")}</div>
        <div class="chart" style="height:52px;margin:2px 0 10px"><canvas id="cv-sp-m"></canvas></div>
        <div class="k">${esc((D.structure?.[1]?.name) || "NQ")}</div>
        <div class="chart" style="height:52px"><canvas id="cv-sp-n"></canvas></div>
      </div></div>
      <div class="hud"><h2>Economic wire <em>IST</em></h2><div id="ev"></div></div>
      <div class="hud"><h2>Paper R curve <em>beta stream</em></h2><div class="pad"><div class="chart" style="height:150px"><canvas id="cv-r"></canvas></div></div></div>
    </div>
  </div>`;

  $("#pb").innerHTML = (S.playbook || []).map(inst => {
    const setups = (inst.setups || []).map(s => `
      <div style="padding:13px 0;border-top:1px dashed var(--line)">
        <div class="srow">
          <span class="badge ${gradeCls(s.grade)}">${esc(s.grade || "—")} ${s.score != null ? `· ${s.score}/14` : ""}</span>
          <span class="badge ${biasCls(s.bias)}">${esc(String(s.bias || "").toUpperCase())}</span>
          <span class="badge neutral">${esc(s.kind || "—")}</span>
          <span class="k">POI ${s.zone ? `${nf(Math.min(...s.zone), 1)}–${nf(Math.max(...s.zone), 1)}` : "—"}</span>
          <span class="k">conf ${s.conf ?? "—"} · vote ${s.vote ?? "—"}</span>
          <span class="k" style="margin-left:auto">TP1 ${nf(s.t1r, 1)}R · TP2 ${nf(s.t2r, 1)}R</span>
        </div>
        <div class="kv">
          <div><div class="lab">entry</div><b>${nf(s.entry, 1)}</b></div>
          <div><div class="lab">stop</div><b class="neg">${nf(s.stop, 1)}</b></div>
          <div><div class="lab">risk</div><b>${nf(s.risk, 1)}pt <small style="color:var(--dim)">${s.risk_usd != null ? "$" + nf(s.risk_usd, 0) : ""}</small></b></div>
          <div><div class="lab">spot→entry</div><b>${s.dist != null ? nf(s.dist, 1) + "pt" : "—"} <small style="color:var(--dim)">${s.dist_atr != null ? nf(s.dist_atr, 1) + "×ATR" : ""}</small></b></div>
          <div><div class="lab">targets</div><b>${(s.tps || []).length}</b></div>
        </div>
        ${ladder(inst, s)}
        <div class="chiprow">${(s.why || []).map(w => `<span class="tag${/out of range|weak|thin|penal/i.test(w) ? " x" : ""}">${esc(w)}</span>`).join("")}</div>
      </div>`).join("");
    return `<div class="inst"><div class="ihead">
      <h3>${esc(inst.name)}</h3>
      <span class="badge ${biasCls(inst.bias)}">${esc(String(inst.bias || "").toUpperCase())}</span>
      ${inst.vol ? `<span class="k">vol ${nf(inst.vol[0], 2)}×</span>` : ""}
      ${(inst.setups[0] || {}).grade ? `<span class="badge ${gradeCls(inst.setups[0].grade)}">top ${esc(inst.setups[0].grade)}</span>` : ""}
      <span class="spot" data-k="spot-${inst.key}" data-v="${inst.spot}">${nf(inst.spot, 1)}</span></div>${setups}</div>`;
  }).join("") || '<div class="empty">playbook.json not found</div>';

  const cl = (D.structure || []).flatMap(i => (i.clusters || []).slice(0, 6).map(x => ({ ...x, name: i.name, spot: i.spot })));
  cl.sort((a, b) => (b.score - a.score) || (Math.abs(a.avg - a.spot) - Math.abs(b.avg - b.spot)));
  $("#cl").innerHTML = cl.slice(0, 9).map(x => {
    const d = x.spot - x.avg;
    return `<div class="barline"><span class="nm">${esc(x.name).split(" ")[0]}</span>
      <span class="bx" style="background:none"><span style="display:flex;gap:8px;align-items:baseline">
        <b style="color:${x.score >= 3 ? cssVar("--bad") : cssVar("--acc")};font-size:13.5px">${nf(x.avg, 1)}</b>
        <span class="k">${esc((x.sources || []).join(" + "))}</span></span></span>
      <span class="vl" style="width:100px;color:var(--dim)">${d > 0 ? "+" : ""}${nf(d, 1)} <span class="k">score ${x.score}</span></span></div>`;
  }).join("") || '<div class="empty">no clusters</div>';

  $("#ev").innerHTML = (S.econ || []).map(e => `<div style="display:flex;gap:10px;padding:9px 16px;border-bottom:1px solid var(--line)">
      <span class="badge ${e.impact === "HIGH" ? "short" : "neutral"}">${esc(e.impact || "")}</span>
      <span style="flex:1"><b style="font-weight:600">${esc(e.title)}</b> <span class="k">${esc(e.cur || "")}</span>
        <div class="k">${esc(e.ist)} IST · ${esc(e.et)} ET</div></span>
      <span class="k" style="color:var(--warn)">in ${e.in_min}m</span></div>`).join("") || '<div class="empty">no upcoming events</div>';

  onDraw(() => {
    const r = $("#cv-r"); if (r && (p.curve || []).length > 1) lineChart(r, p.curve.map((q, i) => ({ cum: q.cum, when: "t" + i })));
    const m = $("#cv-sp-m"); if (m) sparkline(m, closes(mgc));
    const n = $("#cv-sp-n"); if (n) sparkline(n, closes(nq), cssVar("--alt"));
    const b = $("#cv-bul");
    if (b) {
      const rows = [];
      (S.playbook || []).forEach(inst => (inst.setups || []).slice(0, 2).forEach((s, i) => {
        if (s.t1r != null) rows.push({ label: `${inst.key}${i ? " alt" : ""} TP1`, value: s.t1r, target: 1, max: 3 });
        if (s.t2r != null) rows.push({ label: `${inst.key}${i ? " alt" : ""} TP2`, value: s.t2r, target: 2, max: Math.max(3, s.t2r) });
      }));
      if (rows.length) bullets(b, rows);
    }
  });
  requestAnimationFrame(() => { magnetize($("#p-command")); flash($("#p-command")); });
}
const beatWord = s => s == null ? "unknown" : s < 180 ? "healthy" : s < 900 ? "lagging" : "stalled";

/* ============================================================ 02 CASE */
function pCase() {
  const C = D.case;
  if (!C || !C.ok) { $("#p-case").innerHTML = '<div class="hud"><div class="empty">no live case in playbook.json</div></div>'; return; }
  const bull = String(C.bias || "").toLowerCase().startsWith("l");
  const axes = (C.evidence || []).map(e => ({
    k: e.k.replace(" alignment", "").replace(" confirmation", "").replace(" stack", "").replace(" context", ""),
    v: Math.max(4, e.conf), src: e.src,
  }));
  $("#p-case").innerHTML = `
  <div class="hud" style="margin-bottom:15px">
    <h2>Case file <em>${esc(C.case_id)} · playbook ${age(C.age_min)} old</em></h2>
    <div class="pad" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      <div class="casestanmp ${C.live ? "" : "watch"}">${C.live ? "● armed" : "○ watch"}</div>
      <div>
        <div style="font-family:var(--sans);font-size:22px;font-weight:650;color:var(--acc)">${esc(C.inst)}</div>
        <div class="k" style="margin-top:4px">${esc(C.verdict)}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap">
        <span class="badge ${gradeCls(C.grade)}">${esc(C.grade)} · ${C.score}/14</span>
        <span class="badge ${biasCls(C.bias)}">${esc(String(C.bias).toUpperCase())} ${bull ? "▲" : "▼"}</span>
        <span class="badge neutral">${esc(C.kind)}</span>
        <span class="badge neutral">vote ${C.vote ?? "—"} · conf ${C.conf_n ?? "—"}</span>
        <button class="btn" data-jump="structure">open structure ▸<span class="sweepf"></span></button>
      </div>
    </div>
  </div>
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Evidence <em>each axis scored from live structure</em></h2>
        <div class="pad" style="display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:14px;align-items:start">
          <div class="chart" style="height:290px"><canvas id="cv-radar"></canvas></div>
          <div>${(C.evidence || []).map(e => `<div class="ev" style="padding:10px 0">
            <div class="h"><b>${esc(e.k)}</b><span class="src">${esc(e.src || "")}</span></div>
            <p>${esc(e.v)}</p>
            <div class="meter"><i class="${confCls(e.conf)}" style="width:${e.conf}%"></i></div>
          </div>`).join("")}</div>
        </div>
      </div>
      <div class="hud"><h2>Thesis timeline <em>calls + tape events</em></h2><div class="pad"><div class="story">
        ${(C.story || []).map(s => `<div class="st ${esc(s.state || "")}">
          <div class="t">${esc(s.t || "")} · ${esc(s.k || "")}</div>
          <div class="ti">${esc(s.title)}</div>
          <div class="de">${esc(s.detail)}${s.note ? ` — ${esc(s.note).slice(0, 120)}` : ""}</div></div>`).join("") || '<div class="empty">no entries</div>'}
      </div></div></div>
    </div>
    <div class="stack">
      <div class="hud"><h2>Plan <em>${bull ? "long" : "short"} limit at the POI</em></h2><div class="pad">
        <div class="kv">
          <div><div class="lab">entry</div><b>${nf(C.entry, 1)}</b></div>
          <div><div class="lab">stop</div><b class="neg">${nf(C.stop, 1)}</b></div>
          <div><div class="lab">risk</div><b>${nf(C.risk, 1)}pt <small style="color:var(--dim)">$${nf(C.risk_usd, 0)}</small></b></div>
          <div><div class="lab">TP1 / TP2</div><b>${nf(C.t1r, 1)}R / ${nf(C.t2r, 1)}R</b></div>
        </div>
        <table style="margin-top:6px"><thead><tr><th>target</th><th>price</th><th>R</th><th>sources</th></tr></thead><tbody>
          ${(C.tps || []).map((t, i) => `<tr><td class="nw">TP${i + 1}</td><td>${nf(t.price, 1)}</td>
            <td style="color:${rCol(t.r)}">${nf(t.r, 2)}</td><td class="dim" style="font-size:10.5px">${esc((t.sources || []).join(", ") || "—")}</td></tr>`).join("")}
        </tbody></table>
      </div></div>
      <div class="hud"><h2>Invalidation ladder</h2><div class="pad">
        ${(C.invalidation || []).map(i => `<div class="barline"><span class="nm" style="width:86px">${esc(i.label)}</span>
          <span class="bx" style="background:none"><b style="font-size:13px;color:var(--acc)">${nf(i.price, 1)}</b></span>
          <span class="vl k" style="width:150px">${esc(i.note)}</span></div>`).join("")}
      </div></div>
      <div class="hud"><h2>Confluence at the POI <em>${(C.confluence || []).length} levels</em></h2><div class="pad">
        ${(C.confluence || []).map(c => `<div class="barline"><span class="nm" style="width:74px">${nf(c.price, 1)}</span>
          <span class="bx"><i style="left:0;width:${Math.min(100, c.score / 3 * 100)}%;${c.score >= 3 ? `background:linear-gradient(90deg,${cssVar("--bad")},#D3725A)` : ""}"></i></span>
          <span class="vl k" style="width:170px">${esc((c.sources || []).join(" + "))}</span></div>`).join("") || '<div class="k">nothing stacked at this distance</div>'}
        <div class="k" style="margin-top:12px">open POI inventory</div>
        <div class="chiprow" style="margin-top:7px">
          ${(C.open_poi || []).map(z => `<span class="tag ${z.dir === "bull" ? "g" : "x"}">${TF_LABEL[z.tf] || z.tf} ${esc(z.kind)} ${nf(z.bot, 1)}–${nf(z.top, 1)}</span>`).join("")}
        </div>
      </div></div>
    </div>
  </div>`;
  onDraw(() => { const cv = $("#cv-radar"); if (cv && axes.length) radar(cv, axes); });
  requestAnimationFrame(() => { wireButtons($("#p-case")); flash($("#p-case")); });
}

/* ============================================================ 03 STRUCTURE */
function pStructure() {
  const st = D.structure || [];
  if (!st.length) { $("#p-structure").innerHTML = '<div class="hud"><div class="empty">report-*.json not found</div></div>'; return; }
  $("#p-structure").innerHTML = st.map((inst, idx) => {
    const vpc = (inst.vp || {}).vp_current || {}, vpp = (inst.vp || {}).vp_prior || {};
    const vw = inst.vwap || {}, ot = inst.open_type || {};
    const hvn = (vpp.hvn || []).slice(0, 4), lvn = (vpp.lvn || []).slice(0, 3);
    const bars = ((D.series[inst.key] || {}).bars || []).slice(-70);
    return `
    <div class="hud" style="margin-bottom:16px">
      <h2>${esc(inst.name)} · structure <em>${esc((inst.spec || {}).rth_str || "")} · report ${age(inst.zones_age_min)} old</em></h2>
      <div class="pad">
        <div class="cols c-2" style="margin-bottom:15px">
          <div class="hud" style="padding:13px"><div class="k">5m tape with live zones <em>· ${bars.length} bars</em></div>
            <div class="chart" style="height:180px;margin-top:8px"><canvas id="cv-cand-${idx}"></canvas></div></div>
          <div class="hud" style="padding:13px"><div class="k">ATR zone dial <em>· distance from spot in 5m-ATR</em></div>
            <div class="chart" style="height:236px;margin-top:4px"><canvas id="cv-rad-${idx}"></canvas></div></div>
        </div>
        ${structMap(inst)}
        <div class="cols c-3" style="margin-top:15px">
          <div class="hud" style="padding:13px"><div class="k">HTF → LTF alignment</div>
            <table style="margin-top:8px"><thead><tr><th>tf</th><th>trend</th><th>event</th><th>atr</th><th>spot Δ</th></tr></thead><tbody>
              ${(inst.tfs || []).map(t => `<tr><td class="nw"><b>${TF_LABEL[t.tf] || t.tf}</b></td>
                <td><span class="badge ${t.trend === "up" ? "long" : "short"}">${esc(t.trend || "—")}</span></td>
                <td class="dim">${esc(t.event || "—")}</td><td class="dim">${nf(t.atr, 1)}</td>
                <td class="dim">${t.dist_atr != null ? nf(t.dist_atr, 1) + "×" : "—"}</td></tr>`).join("")}
            </tbody></table>
            <div class="chiprow" style="margin-top:11px">
              <span class="tag c">VWAP ${nf(vw.vwap, 1)}</span><span class="tag">σ1 ${nf(vw.s1d, 1)}–${nf(vw.s1u, 1)}</span>
              <span class="tag">σ2 ${nf(vw.s2d, 1)}–${nf(vw.s2u, 1)}</span>
              <span class="tag">sess open ${nf(ot.sess_open, 1)}</span>
            </div>
          </div>
          <div class="hud" style="padding:13px"><div class="k">Volume profile</div>
            <div class="kv" style="margin-top:8px">
              <div><div class="lab">POC</div><b>${nf(vpc.poc, 1)}</b></div>
              <div><div class="lab">VAH</div><b>${nf(vpc.vah, 1)}</b></div>
              <div><div class="lab">VAL</div><b>${nf(vpc.val, 1)}</b></div>
            </div>
            <div class="k" style="margin-top:10px">prior HVN bands</div>
            ${hvn.map(b => `<div class="barline"><span class="nm">${nf(b.mid, 1)}</span><span class="bx"><i style="left:0;width:${Math.min(100, 22 + (b.hi - b.lo) * 40)}%"></i></span><span class="vl k">${nf(b.lo, 1)}–${nf(b.hi, 1)}</span></div>`).join("") || '<div class="k">none</div>'}
            <div class="k" style="margin-top:10px">prior LVN (fast travel)</div>
            ${lvn.map(b => `<div class="barline"><span class="nm">${nf(b.mid, 1)}</span><span class="bx"><i class="neg" style="left:0;width:${Math.min(100, 18 + (b.hi - b.lo) * 40)}%"></i></span><span class="vl k">${nf(b.lo, 1)}–${nf(b.hi, 1)}</span></div>`).join("") || '<div class="k">none</div>'}
          </div>
          <div class="hud" style="padding:13px"><div class="k">Confluence clusters · ranked</div>
            <div style="margin-top:8px">${(inst.clusters || []).map(c => `<div class="barline"><span class="nm" style="width:80px">${nf(c.avg, 1)}</span>
              <span class="bx"><i style="left:0;width:${Math.min(100, c.score / 3 * 100)}%;${c.score >= 3 ? `background:linear-gradient(90deg,${cssVar("--bad")},#D3725A)` : ""}"></i></span>
              <span class="vl k" style="width:150px">${esc((c.sources || []).join(" + "))}</span></div>`).join("")}</div>
            <div class="k" style="margin-top:12px">session levels</div>
            <table style="margin-top:6px"><tbody>${(inst.sessions || []).map(s => `<tr><td class="dim nw">${esc(s.day)}</td>
              <td>${nf(s.high, 1)}</td><td>${nf(s.low, 1)}</td><td class="dim nw">${s.ib_high ? `${nf(s.ib_low, 1)}–${nf(s.ib_high, 1)}` : "—"}</td></tr>`).join("")}</tbody></table>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
  onDraw(() => st.forEach((inst, idx) => {
    const cv = $(`#cv-cand-${idx}`);
    if (cv) candles(cv, ((D.series[inst.key] || {}).bars || []).slice(-70),
      (inst.zones || []).filter(z => ["60", "15", "5"].includes(z.tf)).slice(-12), inst.spot);
    const rv = $(`#cv-rad-${idx}`);
    if (rv) radialZones(rv, inst);
  }));
}

/* ============================================================ 04 EDGE */
function pEdge() {
  const e = D.edge;
  if (!e || !e.n) { $("#p-edge").innerHTML = '<div class="hud"><div class="empty">trades-v4.json not found</div></div>'; return; }
  const aPlus = (e.by_grade || []).find(g => g.k === "A+"), aG = (e.by_grade || []).find(g => g.k === "A");
  const best = (e.by_kind || []).slice().sort((x, y) => y.sum - x.sum)[0];
  const wHour = (e.hours || []).slice().sort((x, y) => x.sum - y.sum)[0];
  const bHour = (e.hours || []).slice().sort((x, y) => y.sum - x.sum)[0];
  const insight = aPlus && aG && aPlus.sum < 0
    ? `A+ returned <b>${nf(aPlus.sum, 2)}R</b> over ${aPlus.n} (${aPlus.win}% win) while A returned <b>+${nf(aG.sum, 2)}R</b> over ${aG.n} (${aG.win}%). Size A+ no larger than A until it re-earns it.` : "";
  $("#p-edge").innerHTML = `
  <div class="hero">
    ${tile("trades studied", e.n, `${esc(e.range[0])} → ${esc(e.range[1])}`)}
    ${tile("total R", nf(e.sum_r, 2), `${nf(e.avg_win, 2)}R win · ${nf(e.avg_loss, 2)}R loss`)}
    ${tile("win rate", e.win_rate + "%", (e.by_bias || []).map(b => `${esc(b.k)} ${b.win}%`).join(" · "), "teal")}
    ${tile("profit factor", nf(e.pf, 2), `${nf(e.sum_r / e.n, 2)}R per trade`)}
    ${tile("max drawdown", nf(e.max_dd, 2) + "R", "sequential", "clay")}
    ${tile("window", Math.round((new Date(e.range[1]) - new Date(e.range[0])) / 864e5) + "d",
      `${(e.n / Math.max(1, Math.round((new Date(e.range[1]) - new Date(e.range[0])) / 864e5))).toFixed(1)} trades/day`)}
  </div>
  ${insight ? `<div class="hud" style="margin-bottom:15px"><div class="pad" style="border-left:3px solid var(--bad)">
     <div class="k">auto-insight</div><div style="margin-top:5px">${insight}</div></div></div>` : ""}
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Equity curve <em>cumulative R</em></h2><div class="pad"><div class="chart" style="height:250px"><canvas id="cv-eq"></canvas></div></div></div>
      <div class="hud"><h2>Risk geometry <em>MFE vs MAE</em></h2><div class="pad"><div class="chart" style="height:245px"><canvas id="cv-sc"></canvas></div>
        <div class="legend"><span><s style="background:var(--acc)"></s>winner</span><span><s style="background:var(--bad)"></s>loser</span><span>dashed: 1R risk / 1R reward</span></div></div></div>
      <div class="hud"><h2>Hour of day <em>R by session hour · polar</em></h2><div class="pad"><div class="chart" style="height:260px"><canvas id="cv-pc"></canvas></div>
        <div class="k" style="margin-top:6px">${wHour ? `worst ${String(wHour.h).padStart(2, "0")}:00 (${nf(wHour.sum, 2)}R / ${wHour.n})` : ""}${bHour ? ` · best ${String(bHour.h).padStart(2, "0")}:00 (+${nf(bHour.sum, 2)}R / ${bHour.n})` : ""}</div></div></div>
    </div>
    <div class="stack">
      <div class="hud"><h2>R distribution <em>buckets + density</em></h2><div class="pad"><div class="chart" style="height:190px"><canvas id="cv-h"></canvas></div></div></div>
      <div class="hud"><h2>Edge by bucket</h2><div id="edge-tbl"></div></div>
      ${best ? `<div class="hud"><div class="pad"><div class="k">strongest pattern</div>
        <div style="margin-top:5px"><b>${esc(best.k)}</b>: ${best.n} trades · ${best.win}% · <span style="color:var(--acc)">+${nf(best.sum, 2)}R</span> · ${nf(best.avg, 3)}R each</div></div></div>` : ""}
    </div>
  </div>
  <div class="hud" style="margin-top:15px"><h2>Trade ledger <em>${e.n} trades</em></h2>
    <div class="maxh"><table><thead><tr><th>when</th><th>inst</th><th>kind</th><th>grade</th><th>side</th><th>entry</th><th>risk</th><th>MFE</th><th>MAE</th><th>R</th></tr></thead><tbody>
    ${e.table.map(t => `<tr><td class="dim nw">${esc(t.when)}</td>
      <td class="nw"><span class="badge ${biasCls(t.bias)}">${esc(String(t.key).toUpperCase())}</span></td>
      <td class="dim">${esc(t.kind)}</td><td><span class="badge ${gradeCls(t.grade)}">${esc(t.grade)}</span></td>
      <td class="dim">${esc(t.bias)}</td><td class="dim">${nf(t.entry, 1)}</td><td class="dim">${nf(t.risk_pts, 1)}pt</td>
      <td class="dim">${nf(t.mfe, 2)}R</td><td class="dim">${nf(t.mae, 2)}R</td>
      <td style="color:${rCol(t.r)}"><b>${nf(t.r, 2)}R</b></td></tr>`).join("")}
    </tbody></table></div></div>`;
  onDraw(() => {
    lineChart($("#cv-eq"), e.curve, { yFmt: v => nf(v, 1) + "R" });
    const rs = e.curve.map(c => c.r).filter(v => v != null);
    barChart($("#cv-h"), e.hist.map(b => ({ k: b.b + "R", v: b.n, tip: `${b.n} trades at ${b.b}R` })), { density: kde(rs) });
    scatterChart($("#cv-sc"), e.scatter);
    const pc = $("#cv-pc"); if (pc) polarClock(pc, e.hours || []);
    const sec = (title, rows) => `<div class="doc"><div class="k">${title}</div>
      <table style="margin-top:5px"><tbody>${rows.map(r => `<tr><td class="nw"><b>${esc(r.k)}</b></td><td class="dim">${r.n} n</td>
        <td class="dim">${r.win}%</td><td style="color:${rCol(r.sum)}">${r.sum > 0 ? "+" : ""}${nf(r.sum, 2)}R</td>
        <td class="dim">${nf(r.avg, 3)}</td></tr>`).join("")}</tbody></table></div>`;
    $("#edge-tbl").innerHTML = sec("by setup kind", e.by_kind) + sec("by grade", e.by_grade) + sec("by instrument", e.by_key) + sec("by side", e.by_bias);
  });
  requestAnimationFrame(() => { magnetize($("#p-edge")); flash($("#p-edge")); });
}

/* ============================================================ 05 JOURNAL */
function pJournal() {
  const S = D.state; if (!S) return;
  const c = S.calls, p = S.paper;
  const outs = {}; (c.rows || []).forEach(r => outs[r.outcome] = (outs[r.outcome] || 0) + 1);
  $("#p-journal").innerHTML = `
  <div class="hero">
    ${tile("calls logged", c.stats.count ?? 0, esc(c.day || ""))}
    ${tile("open", c.stats.open ?? 0, `${c.stats.pending ?? 0} pending`)}
    ${tile("wins", c.stats.win ?? 0, `${c.stats.loss ?? 0} losses`)}
    ${tile("missed", c.stats.missed ?? 0, "never filled", "sun")}
    ${tile("paper R", nf(p.cum_r, 2), `${p.resolved} resolved`)}
    ${tile("events", p.count, `${p.win_rate == null ? "—" : p.win_rate + "%"} hit`, "teal")}
  </div>
  <div class="hud" style="margin-bottom:15px"><h2>Outcome mix <em>today's call dispositions</em></h2><div class="pad">
    <div style="display:flex;height:26px;overflow:hidden;border:1px solid var(--line)">
      ${Object.entries(outs).map(([k, v]) => {
    const col = k === "win" ? cssVar("--acc") : k === "loss" ? cssVar("--bad") : k === "open" ? cssVar("--warn") : cssVar("--faint");
    return `<div style="flex:${v};background:${col}33;border-right:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:9.5px;color:${col}"
          title="${esc(k)}: ${v}">${esc(k)} ${v}</div>`;
  }).join("")}
    </div>
  </div></div>
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Calls · ${esc(c.day || "")}</h2><div class="maxh"><table>
        <thead><tr><th>job</th><th>grade</th><th>side</th><th>entry</th><th>stop</th><th>risk</th><th>targets R</th><th>outcome</th></tr></thead><tbody>
        ${(c.rows || []).map(r => `<tr><td class="nw">${esc(r.job)}</td>
          <td><span class="badge ${gradeCls(r.grade)}">${esc(r.grade || "—")}</span></td>
          <td><span class="badge ${biasCls(r.bias)}">${esc(String(r.bias || "").toUpperCase())}</span></td>
          <td>${nf(r.entry, 1)}</td><td class="dim">${nf(r.stop, 1)}</td>
          <td class="nw">${nf(r.risk, 1)}pt <span class="dim">${S.usd_per_pt?.[r.key] ? `/ $${S.usd_per_pt[r.key]}` : ""}</span></td>
          <td class="dim">${tpsOf(r.entry, r.risk, r.tps)}</td>
          <td><span class="st ${esc(r.outcome)}">${esc(r.outcome)}</span>${r.outcome_note ? `<div class="k" style="white-space:normal;margin-top:4px">${esc(r.outcome_note).slice(0, 100)}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="hud"><h2>Desk output <em>verbatim</em></h2><div class="pad" id="j-out"></div></div>
    </div>
    <div class="stack">
      <div class="hud"><h2>Paper stream</h2><div class="maxh"><table>
        <thead><tr><th>rec</th><th>event</th><th>inst</th><th>grade</th><th>R</th></tr></thead><tbody>
        ${(p.rows || []).map(r => `<tr><td class="dim">${esc(r.rec_id)}</td><td>${esc(r.event)}${r.final ? ' <span class="k">final</span>' : ""}</td>
          <td class="nw"><span class="badge ${biasCls(r.bias)}">${esc(String(r.key || "").toUpperCase())}</span></td>
          <td><span class="badge ${gradeCls(r.grade)}">${esc(r.grade || "—")}</span></td>
          <td style="color:${rCol(r.r)}">${nf(r.r, 2)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">no paper events</td></tr>'}
        </tbody></table></div></div>
      <div class="hud"><h2>Lessons <em>${(S.lessons || []).length}</em></h2><div id="j-les"></div></div>
    </div>
  </div>`;
  $("#j-out").innerHTML = (S.outputs || []).filter(o => o.body && o.body.trim()).map(o => `<div class="out">
      <div class="top"><span class="k">${esc(o.title)}</span><span class="k" style="margin-left:auto">${esc(o.file)} · ${age(o.age_min)}</span></div>
      <pre>${esc(o.body.trim()).slice(0, 1800)}</pre></div>`).join("") || '<div class="empty">no output files</div>';
  $("#j-les").innerHTML = (S.lessons || []).map(x => `<div class="doc"><b>${esc(x.rec_id || "")}</b>
      <span class="k">${esc(x.when || "")} · ${esc(String(x.key || "").toUpperCase())} · r=${x.r ?? "—"}</span>
      ${(x.body || []).map(b => `<div style="margin-top:4px">${esc(b)}</div>`).join("")}</div>`).join("")
    || '<div class="empty">no resolutions yet</div>';
  requestAnimationFrame(() => { magnetize($("#p-journal")); flash($("#p-journal")); });
}
const tpsOf = (entry, risk, tps) =>
  (tps || []).map(t => risk ? Math.abs((entry - t) / risk) : null).filter(x => x != null).map(x => nf(x, 1)).join(" · ") || "—";

/* ============================================================ 06 FLOW */
function pFlow() {
  const F = D.flow; if (!F) return;
  const heat = F.heat || { hours: 24, grid: {}, order: [] };
  const counts = {}; (F.agents || []).forEach(a => counts[a.name] = (a.runs || []).length);
  const cell = (job, h) => {
    const s = (heat.grid[job] || {})[h];
    const cls = !s ? "" : s === "completed" ? "ok" : s === "running" ? "run" : "bad";
    return `<div class="ledcell" title="${esc(job)} · ${h}h ago · ${esc(s || "no run")}"><span class="led ${cls}"></span></div>`;
  };
  $("#p-flow").innerHTML = `
  <div class="hero">
    ${tile("pipeline stages", (F.steps || []).length, "scan → post → journal → learn")}
    ${tile("agents", (F.agents || []).length, `${(F.agents || []).filter(a => a.failure_streak).length} failing`)}
    ${tile("runs logged", (F.feed || []).length, "job outputs")}
    ${tile("last run", (F.feed || [])[0] ? (F.feed[0].age_s < 120 ? Math.round(F.feed[0].age_s) + "s" : hms(F.feed[0].age_s)) : "—", esc((F.feed || [])[0] ? F.feed[0].job : ""), "plum")}
    ${tile("tokens today", (((D.state || {}).pulse || {}).tokens_today || 0).toLocaleString(), "agent spend", "sun")}
  </div>
  <div class="hud" style="margin-bottom:15px"><h2>The desk, as a pipeline <em>each stage is a real cron job</em></h2>
    <div class="pipe"><div class="track">
      ${(F.steps || []).map((s, i) => {
    const live = s.next_in_s != null && s.next_in_s < 300;
    const box = `<div class="box ${s.failure_streak ? "err" : ""}${live ? " live" : ""}" data-node="${s.id}">
        <div class="nm">${esc(s.name)}</div><div class="ds">${esc(s.desc)}</div>
        <div class="mt">${leds(s.runs)}<span>${s.next_in_s != null ? "in " + hms(s.next_in_s) : "auto"}</span></div></div>`;
    return `<div class="node"><div class="idx">${String(i + 1).padStart(2, "0")}</div>${box}</div>` +
      (i === (F.steps || []).length - 1 ? "" : `<div class="linkwrap"><svg viewBox="0 0 56 16"><path class="flowline" d="M2,8 L54,8"/></svg></div>`);
  }).join("")}
    </div></div>
    <div class="ribbons"><svg id="cv-ribbons"></svg></div>
    <div class="pad k" style="padding-top:0">ribbon thickness = runs recorded this session · click a stage for its latest output</div>
  </div>
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Agent roster <em>health · cadence</em></h2><div class="pad"><div class="agents">
        ${(F.agents || []).map(a => `<div class="agent"><div class="top">
          <span class="dot ${a.failure_streak ? "red" : a.status === "ok" ? "" : "grey"}"></span>
          <span class="nm">${esc(a.name)}</span>${a.no_agent ? '<span class="k">no-LLM</span>' : ""}</div>
          <div class="row"><span class="k">schedule</span><span>${esc(a.sched || "—")}</span></div>
          <div class="row"><span class="k">next</span><span style="color:var(--alt)" data-nx="${a.next_in_s ?? ""}" data-cd>${hms(a.next_in_s)}</span></div>
          <div class="row"><span class="k">last</span><span>${esc(a.last_run || "—")}</span></div>
          <div class="row"><span class="k">duration</span><span>${a.avg_dur == null ? "—" : a.avg_dur + "s"}${a.max_dur ? ` <span class="k">max ${a.max_dur}s</span>` : ""}</span></div>
          <div class="row" style="margin-top:7px">${leds(a.runs)}</div>
        </div>`).join("")}
      </div></div></div>
      <div class="hud"><h2>Run LED matrix <em>job × hour · last ${heat.hours}h</em></h2><div class="pad">
        <div class="gear-wrap"><div class="gear"><div></div>
          ${Array.from({ length: heat.hours }, (_, i) => `<div class="hd">${heat.hours - 1 - i === 0 ? "now" : heat.hours - 1 - i}</div>`).join("")}
          ${(heat.order || []).map(job => `<div class="jn">${esc(job)}</div>` +
    Array.from({ length: heat.hours }, (_, i) => cell(job, heat.hours - 1 - i)).join("")).join("")}
        </div></div>
        <div class="legend"><span><s style="background:var(--acc)"></s>completed</span>
          <span><s style="background:var(--warn)"></s>running</span><span><s style="background:var(--bad)"></s>error</span>
          <span>off = no run · columns = hours ago</span></div>
      </div></div>
    </div>
    <div class="hud"><h2>Run feed <em>live</em></h2><div class="feed" id="runfeed"></div></div>
  </div>`;
  ribbons($("#cv-ribbons"), F.steps || [], counts);
  renderFeed();
  $$("#p-flow .node .box").forEach(b => b.onclick = () => {
    const s = (F.steps || []).find(x => x.id === b.dataset.node) || {};
    const hit = (F.feed || []).find(f => f.job === s.job);
    $("#runfeed").innerHTML = `<div class="pad">
      <div class="k">stage ${esc(s.name)} · ${esc(s.job || "internal")}</div>
      <div style="margin-top:6px">${esc(s.desc)}</div>
      <div class="k" style="margin-top:12px">latest output</div>
      <pre class="term" style="margin-top:6px">${hit ? esc(hit.body) : "no output artefact for this stage"}<span class="cursor"></span></pre>
      <button class="btn" id="backfeed" style="margin-top:10px">← live feed<span class="sweepf"></span></button></div>`;
    wireButtons($("#runfeed"));
    const b2 = $("#backfeed"); if (b2) b2.onclick = renderFeed;
  });
  requestAnimationFrame(() => { magnetize($("#p-flow")); flash($("#p-flow")); tickCountdowns(); });
}
function renderFeed() {
  const F = D.flow; if (!F) return;
  const el = $("#runfeed"); if (!el) return;
  el.innerHTML = (F.feed || []).map((f, i) => `<div class="row ${i === 0 && f.age_s < 90 ? "fresh" : ""}">
      <span class="dot ${f.age_s < 300 ? "" : "grey"}"></span>
      <span class="n">${esc(f.job)}<div class="k" style="white-space:normal">${esc(f.head || "")}</div></span>
      <span class="s">${nf(f.kb, 1)}kb</span><span class="t">${esc(f.ts)}</span></div>`).join("")
    || '<div class="empty">no run outputs yet</div>';
}

/* ============================================================ 07 SYSTEM */
function pSystem() {
  const S = D.state; if (!S) return;
  const pu = S.pulse, beat = pu.heartbeat_age_s != null && pu.heartbeat_age_s < 180;
  const act = S.activity || [];
  $("#p-system").innerHTML = `
  <div class="hero">
    ${tile("ticker beat", pu.heartbeat_age_s == null ? "—" : hms(pu.heartbeat_age_s), beat ? "healthy" : "stale — check gateway", beat ? "" : "clay")}
    ${tile("last success", pu.last_success_age_s == null ? "—" : hms(pu.last_success_age_s), "clean tick")}
    ${tile("runs today", pu.runs_today ?? 0, `${(pu.tokens_today || 0).toLocaleString()} tokens`, "plum")}
    ${tile("gateway jobs", (S.crons || []).length, `${(S.crons || []).filter(c => c.failure_streak).length} failing`)}
    ${tile("files hot", act.length, "touched in 36h")}
  </div>
  <div class="split">
    <div class="stack">
      <div class="hud"><h2>Cron desk <em>scheduler</em></h2><div class="maxh"><table>
        <thead><tr><th>job</th><th>schedule</th><th>next</th><th>runs</th><th>delivery</th><th>last</th><th>dur</th></tr></thead><tbody>
        ${(S.crons || []).map(c => `<tr>
          <td class="nw"><span class="dot ${c.status === "error" ? "red" : c.status === "ok" ? "" : "grey"}" style="display:inline-block;margin-right:8px"></span>${c.enabled ? "" : "◌ "}${esc(c.name)}</td>
          <td class="dim nw">${esc(c.sched || "—")}</td>
          <td class="nw" style="color:var(--alt)" data-nx="${c.next_in_s ?? ""}" data-cd>${hms(c.next_in_s)}</td>
          <td>${leds(c.runs)}</td>
          <td class="k nw">${(c.deliveries || []).slice(0, 2).map(d => esc(d)).join(" · ") || "—"}</td>
          <td class="dim nw">${esc(c.last_run || "—")}${c.failure_streak ? ` <span style="color:var(--bad)">${c.failure_streak}f</span>` : ""}</td>
          <td class="dim">${c.avg_dur == null ? "—" : c.avg_dur + "s"}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="hud"><h2>Desk churn treemap <em>area = file size · colour = freshness</em></h2>
        <div class="pad"><div class="chart" style="height:300px"><canvas id="cv-tree"></canvas></div>
          <div class="legend"><span><s style="background:var(--acc)"></s>touched &lt; 4h</span>
            <span><s style="background:var(--warn)"></s>stale &gt; 4h</span><span>hover a block for detail</span></div></div></div>
    </div>
    <div class="stack">
      <div class="hud"><h2>State files <em>freshness</em></h2><div class="pad">
        ${Object.entries(S.files || {}).map(([f, a]) => {
    const pct = Math.max(4, Math.min(100, 100 - a / 60 * 100)), stale = a > 45;
    return `<div class="barline"><span class="nm" style="width:126px;font-size:9.5px">${esc(f)}</span>
          <span class="bx"><i style="left:0;width:${pct}%;${stale ? `background:linear-gradient(90deg,${cssVar("--warn")},#E0B45E)` : ""}"></i></span>
          <span class="vl k" style="width:70px" data-k="fresh-${f}" data-v="${Math.round(a)}">${age(a)}</span></div>`;
  }).join("")}
      </div></div>
      <div class="hud"><h2>Doctrine <em>constitution</em></h2><div id="s-doc"></div></div>
      <div class="hud"><h2>Wire <em>upcoming · IST</em></h2><div id="s-ev"></div></div>
    </div>
  </div>`;
  $("#s-doc").innerHTML = (S.doctrine.lines || []).map(l => `<div class="doc">${esc(l)}</div>`).join("") || '<div class="empty">not parsed</div>';
  $("#s-ev").innerHTML = (S.econ || []).map(e => `<div class="doc" style="display:flex;gap:10px">
      <span class="badge ${e.impact === "HIGH" ? "short" : "neutral"}">${esc(e.impact || "")}</span>
      <span style="flex:1">${esc(e.title)} <span class="k">${esc(e.cur || "")} · ${esc(e.ist)}</span></span>
      <span class="k">${e.in_min}m</span></div>`).join("") || '<div class="empty">none</div>';
  onDraw(() => { const cv = $("#cv-tree"); if (cv) treemap(cv, act); });
  requestAnimationFrame(() => { magnetize($("#p-system")); wireButtons($("#p-system")); flash($("#p-system")); tickCountdowns(); });
}

/* ============================================================ chrome + perf */
let clockBase = null;
function header() {
  const S = D.state; if (!S) return;
  const s = S.session, hot = !!s.killzone;
  const chip = $("#chip-sess");
  chip.className = "chip" + (hot ? " hot" : "");
  chip.innerHTML = `<span class="dot ${hot ? "red" : "grey"}"></span><span>${esc(s.market)} · ${esc(s.label)}</span>`;
  $("#date").textContent = `${S.ist_date} · ${S.et_date} ET`;
  clockBase = { t: Date.now(), ist: S.ist, et: S.et };
  const host = document.getElementById("p-" + D.page);
  $("#gen").textContent = `state ${S.generated_at} IST · ${D.page} ${host ? host.innerHTML.length + " chars" : "MISSING"}`;
  const hr = (S.et || "00:00:00").slice(0, 2) * 1 + (S.et || "00:00").slice(3, 5) / 60;
  const cur = hr >= 20 ? hr : hr + 24;
  const hm = h => `${Math.floor(h % 24)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  $("#kz").innerHTML = [["Asia", 20, 26], ["NY", 9.5, 13.5]].map(([n, a, b]) => {
    const inz = cur >= a && cur < b, pct = inz ? ((cur - a) / (b - a) * 100).toFixed(1) : 0;
    return `<span class="k" style="color:${inz ? "var(--bad)" : "var(--faint)"}">${n} ${hm(a)}–${hm(b)}</span>
      <span class="killbar"><i style="width:${inz ? pct : 0}%"></i>${inz ? `<b style="left:${pct}%"></b>` : ""}</span>`;
  }).join("");
  renderTape(S.tape || []);                    // only when the content actually changes
  tickClock();
}
/* marquee: written once per content change, never on a timer */
let tapeSig = "";
function renderTape(items) {
  const sig = items.map(i => i.t + (i.k || "")).join("|");
  if (sig === tapeSig) return;
  tapeSig = sig; S_.tapeWrites++;
  const seg = `<div class="seg">${items.map(t =>
    `<span class="it ${t.k === "cy" ? "cy" : t.k === "up" ? "up" : t.k === "warn" ? "warn" : ""}"><em>◆</em> <b>${esc(t.t)}</b></span>`).join("")}</div>`;
  const tr = $("#tape");
  tr.innerHTML = seg + seg;                    // two identical halves → seamless -50% loop
  tr.style.setProperty("--tape-dur", Math.max(46, items.length * 7) + "s");
}
/* 1s tick: text nodes only — no innerHTML anywhere near the marquee */
const secs = t => t ? (t.slice(0, 2) * 3600 + t.slice(3, 5) * 60 + (+t.slice(6, 8) || 0)) : null;
const fmt = s => `${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function tickClock() {
  if (!clockBase) return;
  const el = (Date.now() - clockBase.t) / 1000;
  const bi = secs(clockBase.ist), be = secs(clockBase.et);
  const ist = $("#ist"), et = $("#et");
  if (ist && bi != null) ist.textContent = fmt(bi + el);
  if (et && be != null) et.textContent = fmt(be + el);
  D.pushAge++;
  const f = $("#fresh");
  if (f) f.innerHTML = window.__SNAP ? `<span class="dot amber"></span><span>snapshot</span>`
    : D.conn === "stream" ? `<span class="dot teal"></span><span>push · ${D.pushAge}s</span>`
      : `<span class="dot grey"></span><span>poll</span>`;
  const sc = $("#streamchip"), sc2 = $("#streamchip2");
  const txt = D.topics.length ? `pushed ${D.topics.join(" ")} · ${D.pushAge}s ago` : "awaiting push";
  if (sc) sc.textContent = txt;
  if (sc2) sc2.textContent = txt;
  const st = $("#stats");
  if (st) st.textContent = `renders ${S_.renders} · tape ${S_.tapeWrites} · draws ${S_.draws}${S_.drawErr ? ` · drawErr ${S_.drawErr}` : ""} · refetch ${S_.refetch} · push ${S_.pushes} · ${theme()}`;
}
function tickCountdowns() {
  $$("[data-nx]").forEach(tr => {
    if (tr.dataset.nx === "") return;
    let s = parseInt(tr.dataset.nx, 10) - 1;
    if (isNaN(s)) return;
    tr.dataset.nx = s;
    const c = tr.matches("[data-cd]") ? tr : tr.querySelector("[data-cd]");
    if (c) c.textContent = hms(Math.max(0, s));
  });
}
function render() {
  S_.renders++;
  DRAWS.length = 0;                     // page renderers re-register their canvas draws
  const fn = ({ command: pCommand, case: pCase, structure: pStructure, edge: pEdge, journal: pJournal, flow: pFlow, system: pSystem })[D.page];
  header();
  try { fn(); } catch (e) {
    const el = document.getElementById("p-" + D.page);
    if (el) el.innerHTML = `<div class="hud"><div class="pad"><div class="k" style="color:var(--bad)">render error · ${esc(D.page)}</div>
      <pre>${esc((e && (e.stack || e.message)) || String(e))}</pre></div></div>`;
  }
  /* RUN the registered canvas draws — without this every chart stays blank */
  const draws = DRAWS.slice();
  requestAnimationFrame(() => {
    draws.forEach(f => {
      try { f(); S_.draws++; }
      catch (e) {
        S_.drawErr++;
        const g = document.getElementById("gen");
        if (g) g.textContent = `draw error: ${(e && e.message) || e}`;
      }
    });
    tickClock();
  });
  tickClock();
}
addEventListener("error", e => {
  const g = document.getElementById("gen");
  if (g) g.textContent = `js error: ${e.message} @ ${e.lineno}:${e.colno}`;
});
addEventListener("unhandledrejection", e => {
  const g = document.getElementById("gen");
  if (g) g.textContent = `js rejection: ${(e.reason && e.reason.message) || e.reason}`;
});
function go(page) {
  D.page = page;
  $$("nav a").forEach(a => a.classList.toggle("on", a.dataset.p === page));
  $$(".page").forEach(p => p.classList.toggle("on", p.id === "p-" + page));
  if (location.hash.slice(1) !== page) history.replaceState(null, "", "#" + page);
  DRAWS.length = 0;
  render();
  scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------------------------------------------------------- data */
const SNAP = () => window.__SNAP;
async function fetchJson(url) {
  if (SNAP()) return SNAP()[url] ?? {};
  try { const r = await fetch(url, { cache: "no-store" }); return await r.json(); } catch (e) { return { error: String(e) }; }
}
const TOPIC_FETCH = {
  state: ["/api/state", "/api/case"], structure: ["/api/structure", "/api/case"],
  edge: ["/api/edge"], flow: ["/api/flow"], ops: ["/api/state", "/api/flow"],
};
const STORE = {
  "/api/state": v => D.state = v, "/api/structure": v => D.structure = Array.isArray(v) ? v : [],
  "/api/edge": v => D.edge = v, "/api/flow": v => D.flow = v, "/api/case": v => D.case = v,
};
async function refresh(urls) {
  const res = await Promise.all(urls.map(fetchJson));
  urls.forEach((u, i) => STORE[u] && STORE[u](res[i]));
  S_.refetch += urls.length;
  D.lastFetch = Date.now();
  DRAWS.length = 0;
  render();
}
let pending = new Set(), flushT = null;
function queue(topics) {
  topics.forEach(t => (TOPIC_FETCH[t] || []).forEach(u => pending.add(u)));
  D.topics = topics; D.pushAge = 0; S_.pushes++;
  clearTimeout(flushT);
  flushT = setTimeout(() => { const urls = [...pending]; pending.clear(); if (urls.length) refresh(urls); }, 700);
}
let es = null;
function connect() {
  if (SNAP() || !("EventSource" in window)) { D.conn = "poll"; return; }
  try { es = new EventSource("/api/stream"); } catch (e) { D.conn = "poll"; return; }
  es.onopen = () => { D.conn = "stream"; };
  es.addEventListener("update", ev => {
    try { const d = JSON.parse(ev.data); D.conn = "stream"; queue(d.topics || []); } catch (e) { }
  });
  es.onerror = () => { D.conn = "poll"; try { es.close(); } catch (e) { } setTimeout(connect, 6000); };
}
function boot() {
  const lines = ["<b>investigation console</b> · booting", "desk state link … <span class='ok'>ok</span>",
    "structure + zones … <span class='ok'>ok</span>", "edge study … <span class='ok'>ok</span>",
    "pipeline + agents … <span class='ok'>ok</span>", "push stream … <span class='ok'>ok</span>"];
  const el = $("#boot .log"); let i = 0;
  const type = () => {
    if (i >= lines.length) { el.innerHTML += `<div><span class="cursor"></span></div>`; return; }
    el.innerHTML += `<div>${lines[i++]}<span class="cursor"></span></div>`;
    setTimeout(type, 150);
  };
  type();
  setTimeout(() => { $("#boot").classList.add("done"); setTimeout(() => $("#boot")?.remove(), 600); }, 1500);
}

/* command palette */
const ITEMS = () => [
  ...PAGES.map((p, i) => ({ t: `${String(i + 1).padStart(2, "0")} · ${p[0].toUpperCase() + p.slice(1)}`, g: "page", act: () => go(p) })),
  { t: "toggle theme (dark ⇄ evergreen)", g: "action", act: () => setTheme(theme() === "dark" ? "light" : "dark") },
  { t: "MGC structure map", g: "instrument", act: () => go("structure") },
  { t: "NQ structure map", g: "instrument", act: () => go("structure") },
  { t: "today's case file", g: "case", act: () => go("case") },
  { t: "edge lab · backtest study", g: "study", act: () => go("edge") },
  { t: "pipeline + agent roster", g: "flow", act: () => go("flow") },
  { t: "force refetch everything", g: "action", act: () => tick(true) },
  ...((D.state || {}).crons || []).map(c => ({ t: c.name, g: `cron · ${c.sched || ""}`, act: () => go("flow") })),
];
let palSel = 0, palRes = [];
function palRender(q = "") {
  const all = ITEMS();
  palRes = q ? all.filter(i => (i.t + " " + i.g).toLowerCase().includes(q.toLowerCase())) : all;
  palSel = 0;
  $("#pal .res").innerHTML = palRes.map((r, i) => `<div class="r ${i === palSel ? "sel" : ""}" data-i="${i}">
      <span class="tt">${esc(r.t)}</span><span class="gr">${esc(r.g)}</span></div>`).join("") || '<div class="empty">nothing matches</div>';
  $$("#pal .r").forEach(el => el.onclick = () => { palRes[+el.dataset.i].act(); palClose(); });
}
const palOpen = () => { $("#pal").classList.add("on"); $("#pal input").value = ""; palRender(); $("#pal input").focus(); };
const palClose = () => $("#pal").classList.remove("on");
function palMove(d) {
  palSel = Math.max(0, Math.min(palRes.length - 1, palSel + d));
  $$("#pal .r").forEach((el, i) => el.classList.toggle("sel", i === palSel));
  const s = $$("#pal .r")[palSel]; if (s) s.scrollIntoView({ block: "nearest" });
}

/* ---------------------------------------------------------------- wiring */
addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#pal").classList.contains("on") ? palClose() : palOpen(); return; }
  if ($("#pal").classList.contains("on")) {
    if (e.key === "Escape") palClose();
    if (e.key === "ArrowDown") { e.preventDefault(); palMove(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); palMove(-1); }
    if (e.key === "Enter" && palRes[palSel]) { palRes[palSel].act(); palClose(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { "1": "command", "2": "case", "3": "structure", "4": "edge", "5": "journal", "6": "flow", "7": "system" };
  if (map[e.key]) go(map[e.key]);
  if (e.key === "t") setTheme(theme() === "dark" ? "light" : "dark");
  if (e.key === "r") tick(true);
});
$("#themesw").addEventListener("click", () => setTheme(theme() === "dark" ? "light" : "dark"));
$("#pal").addEventListener("click", e => { if (e.target.id === "pal") palClose(); });
$("#pal input").addEventListener("input", e => palRender(e.target.value));
addEventListener("hashchange", () => { const p = location.hash.slice(1); if (PAGES.includes(p) && p !== D.page) go(p); });
addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { DRAWS.length = 0; render(); }, 200); });
document.addEventListener("click", e => { const j = e.target.closest("[data-jump]"); if (j) go(j.dataset.jump); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { DRAWS.length = 0; render(); } });
$$("nav a").forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.p); });

async function tick(full = true) {
  await refresh(full ? ["/api/state", "/api/structure", "/api/edge", "/api/flow", "/api/case"] : ["/api/state"]);
  const [m, n] = await Promise.all([fetchJson(SERIES_URL("mgc")), fetchJson(SERIES_URL("nq"))]);
  D.series = { mgc: m, nq: n };
  if ((m.bars || []).length || (n.bars || []).length) { DRAWS.length = 0; render(); }
}

/* ---------------------------------------------------------------- init */
const initPage = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "command";
D.page = initPage;
$$("nav a").forEach(a => a.classList.toggle("on", a.dataset.p === initPage));
$$(".page").forEach(p => p.classList.toggle("on", p.id === "p-" + initPage));
$("#themelab").textContent = theme();
boot();
tick(true).then(connect);
setInterval(tickClock, 1000);          // clocks + freshness + stats: text nodes only
setInterval(tickCountdowns, 1000);     // next-run cells
setInterval(() => { S_.refetch = S_.refetch; }, 60000);
setInterval(() => tick(true), 180000);          // safety full refresh (SSE normally drives it)
setInterval(() => { if (D.conn !== "stream") tick(true); }, 15000);
