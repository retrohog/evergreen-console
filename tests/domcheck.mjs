/* Headless render audit for the console.
 *
 *   node tests/domcheck.mjs                     # against http://127.0.0.1:8899
 *   node tests/domcheck.mjs http://host:port
 *
 * Stubs just enough DOM to run app.js without a browser, renders every page,
 * and fails loudly on: render errors, unbalanced markup, canvases that never
 * got a draw registered, and empty panels. This is how we catch "half the
 * page didn't load" without screenshots.
 */
const BASE = process.argv[2] || "http://127.0.0.1:8899";
const PAGES = ["command", "case", "structure", "edge", "journal", "flow", "system"];
const RENDER_ERRORS = [];

/* ---------------------------------------------------------------- data FIRST
   (stubbing performance/setTimeout before any fetch breaks undici, so all
   network I/O happens up here, before the fake DOM is installed) */
const snap = {};
for (const p of ["/api/state", "/api/structure", "/api/edge", "/api/flow", "/api/case",
  "/api/series?key=mgc&tf=5&n=180", "/api/series?key=nq&tf=5&n=180"]) {
  const r = await fetch(BASE + p);
  snap[p] = await r.json();
}
const source = await (await fetch(BASE + "/app.js")).text();

/* ---------------------------------------------------------------- fake DOM */
let COLLECT = [];                       // innerHTML writes per element id
const mkEl = (id = "") => {
  const el = {
    id, dataset: {}, style: { setProperty() { } }, children: [],
    _html: "", textContent: "", classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); COLLECT.push({ id, html: this._html }); },
    addEventListener() { }, removeEventListener() { }, remove() { }, appendChild() { }, setAttribute() { },
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 600, height: 300, top: 0, left: 0 }),
    getContext: () => CTX,
    matches: () => false,
    scrollIntoView() { }, focus() { }, closest: () => null,
  };
  return el;
};
const CTX = new Proxy({}, {
  get: (_, k) => {
    if (k === "createLinearGradient" || k === "createRadialGradient")
      return () => ({ addColorStop() { } });
    if (k === "measureText") return () => ({ width: 10 });
    return () => { };
  },
  set: () => true,
});
const REG = new Map();
const q = s => { const id = String(s).replace(/^#/, ""); if (!REG.has(id)) REG.set(id, mkEl(id)); return REG.get(id); };
globalThis.document = {
  documentElement: { dataset: { theme: "dark" } },
  body: mkEl("body"), hidden: false,
  querySelector: q, querySelectorAll: () => [], getElementById: id => q("#" + id),
  createElement: () => mkEl("tmp"), addEventListener() { }, removeEventListener() { },
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.location = { hash: "#command", search: "", href: BASE };
globalThis.localStorage = { getItem: () => null, setItem() { } };
globalThis.history = { replaceState() { } };
globalThis.addEventListener = () => { };
globalThis.removeEventListener = () => { };
globalThis.requestAnimationFrame = fn => { try { fn(0); } catch (e) { RENDER_ERRORS.push("rAF: " + e.message); } return 1; };
if (!globalThis.performance) globalThis.performance = {};
globalThis.performance.now = () => Date.now();          // keep the rest of the real object (undici needs it)
globalThis.innerWidth = 1600;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#2A6A4D" });
globalThis.EventSource = function () { this.addEventListener = () => { }; this.close = () => { }; };
globalThis.scrollTo = () => { };
const REAL_TIMEOUT = globalThis.setTimeout, REAL_INTERVAL = globalThis.setInterval;
globalThis.setTimeout = (fn) => { try { fn(); } catch (e) { RENDER_ERRORS.push("timeout: " + e.message); } return 0; };
globalThis.setInterval = () => 0;
globalThis.clearTimeout = () => { };
globalThis.clearInterval = () => { };
globalThis.__SNAP = snap;

/* ---------------------------------------------------------------- run app.js */
const { createContext, runInContext } = await import("node:vm");
const ctx = createContext(globalThis);
try { runInContext(source, ctx, { filename: "app.js" }); }
catch (e) { console.error("app.js threw during load:", e.message); process.exit(1); }

/* the app boots asynchronously (tick → refresh → render): let it settle first,
   otherwise every renderer bails out on a still-null D.state */
const settle = () => new Promise(r => REAL_TIMEOUT(r, 0));
try { await ctx.tick(true); } catch (e) { console.error("tick() threw:", e.message); }
await settle();
const stats = ctx.__stats || {};
const dataLoaded = (stats.renders || 0) > 0;

/* ---------------------------------------------------------------- audit */
const balance = html => {
  const open = (html.match(/<div\b/g) || []).length, close = (html.match(/<\/div>/g) || []).length;
  const so = (html.match(/<section\b/g) || []).length, sc = (html.match(/<\/section>/g) || []).length;
  const to = (html.match(/<table\b/g) || []).length, tc = (html.match(/<\/table>/g) || []).length;
  const lo = (html.match(/<tr\b/g) || []).length, lc = (html.match(/<\/tr>/g) || []).length;
  return { divOpen: open, divClose: close, secOpen: so, secClose: sc, tableOpen: to, tableClose: tc, trOpen: lo, trClose: lc };
};

let failures = 0;
console.log(`audit vs ${BASE} · data keys: ${Object.keys(snap).length} · state loaded: ${dataLoaded}\n`);
for (const page of PAGES) {
  COLLECT = [];
  const go = ctx.go;
  try { go(page); } catch (e) { console.log(`${page.padEnd(10)} ✗ go() threw: ${e.message}`); failures++; continue; }
  await settle();
  const writes = COLLECT.filter(w => w.id.startsWith("p-") || w.id === page);
  const pageHtml = COLLECT.filter(w => w.id === "p-" + page).map(w => w.html).join("") ||
    COLLECT.map(w => w.html).join("");
  const b = balance(pageHtml);
  const canvases = [...pageHtml.matchAll(/id="(cv-[^"]+)"/g)].map(m => m[1]);
  const uniq = [...new Set(canvases)];
  const d0 = stats.draws || 0, e0 = stats.drawErr || 0;
  const errs = RENDER_ERRORS.filter(e => !/EventSource|fetch/i.test(e));
  const problems = [];
  if (/render error/.test(pageHtml)) problems.push("render-error block");
  if (b.divOpen !== b.divClose) problems.push(`div ${b.divOpen}/${b.divClose}`);
  if (b.tableOpen !== b.tableClose) problems.push(`table ${b.tableOpen}/${b.tableClose}`);
  if (b.trOpen !== b.trClose) problems.push(`tr ${b.trOpen}/${b.trClose}`);
  if (pageHtml.length < 1500) problems.push(`suspiciously small (${pageHtml.length} chars)`);
  if (uniq.length && d0 === 0) problems.push("no canvas draw ran");
  if (e0) problems.push(`${e0} draw error(s)`);
  if (errs.length) problems.push("errors: " + errs.slice(0, 2).join("; "));
  const status = problems.length ? "✗" : "✓";
  if (problems.length) failures++;
  console.log(`${status} ${page.padEnd(10)} ${String(pageHtml.length).padStart(6)} chars · canvases ${uniq.length} [${uniq.join(",").slice(0, 60)}] · draws ${d0}${e0 ? ` drawErr ${e0}` : ""} ${problems.length ? "· " + problems.join(" · ") : ""}`);
}
console.log(failures ? `\n${failures} page(s) with problems` : "\nall pages structurally sound");
process.exit(failures ? 1 : 0);
