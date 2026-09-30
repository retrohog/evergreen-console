/* Snapshot-mode audit.
 *
 *   node tests/snapcheck.mjs [snapshot.html]
 *
 * The snapshot is the artefact that gets shared/previewed: one HTML file with the
 * state and every asset inlined, expected to render with NO server and NO network.
 * So this harness stubs the DOM, makes fetch() throw, feeds window.__SNAP straight
 * out of the file, and renders all 7 pages — catching the "it renders live but the
 * snapshot is blank" class of bug.
 */
import { readFileSync } from "node:fs";
const FILE = process.argv[2] || "snapshot.html";
const html = readFileSync(FILE, "utf8");

/* ---------------------------------------------------------------- pull state */
const m = html.match(/<script>window\.__SNAP = ([\s\S]*?);<\/script>/);
if (!m) { console.error("✗ no window.__SNAP block in " + FILE); process.exit(1); }
const SNAP = JSON.parse(m[1]);
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
/* the file has several <script> blocks (pre-paint theme, __SNAP, app) — app.js is the big one */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
const appJs = blocks.find(b => b.includes("const PAGES =")) || "";
if (!appJs) { console.error("✗ inlined app.js not found in " + FILE); process.exit(1); }

/* inlined assets: every img/css url must be a data: URI (no /assets/ left) */
const externals = [...html.matchAll(/["'(](\/assets\/[^"')]+)/g)].map(x => x[1]);
const dataUris = (html.match(/data:image\//g) || []).length;

/* ---------------------------------------------------------------- fake DOM */
const RENDER_ERRORS = [];
const CTX = new Proxy({}, { get: (_, k) => k === "measureText" ? () => ({ width: 10 }) : () => { }, set: () => true });
let COLLECT = [];
const mkEl = (id = "") => ({
  id, dataset: {}, style: { setProperty() { } }, children: [], _html: "",
  classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = String(v); COLLECT.push({ id, html: this._html }); },
  addEventListener() { }, remove() { }, appendChild() { }, setAttribute() { },
  querySelector: () => null, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ width: 600, height: 300, top: 0, left: 0 }),
  getContext: () => CTX, matches: () => false, scrollIntoView() { }, focus() { }, closest: () => null,
});
const REG = new Map();
const q = s => { const id = String(s).replace(/^#/, ""); if (!REG.has(id)) REG.set(id, mkEl(id)); return REG.get(id); };
globalThis.document = {
  documentElement: { dataset: { theme: "dark" } }, body: mkEl("body"), hidden: false,
  querySelector: q, querySelectorAll: () => [], getElementById: i => q("#" + i),
  createElement: () => mkEl("tmp"), addEventListener() { }, removeEventListener() { },
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.location = { hash: "#command", search: "", href: "file://" + FILE };
globalThis.localStorage = { getItem: () => null, setItem() { } };
globalThis.history = { replaceState() { } };
globalThis.addEventListener = () => { };
globalThis.requestAnimationFrame = fn => { try { fn(0); } catch (e) { RENDER_ERRORS.push("rAF: " + e.message); } return 1; };
if (!globalThis.performance) globalThis.performance = {};
globalThis.performance.now = () => Date.now();
globalThis.innerWidth = 1600;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#2A6A4D" });
globalThis.EventSource = function () { this.addEventListener = () => { }; this.close = () => { }; };
globalThis.scrollTo = () => { };
const REAL_TIMEOUT = globalThis.setTimeout;
globalThis.setTimeout = fn => { try { fn(); } catch (e) { RENDER_ERRORS.push("timeout: " + e.message); } return 0; };
globalThis.setInterval = () => 0; globalThis.clearTimeout = () => { }; globalThis.clearInterval = () => { };
/* the whole point: no network in snapshot mode */
let NET = 0;
globalThis.fetch = async url => { NET++; throw new Error("snapshot must not fetch: " + url); };
globalThis.__SNAP = SNAP;

/* ---------------------------------------------------------------- run */
const { createContext, runInContext } = await import("node:vm");
const ctx = createContext(globalThis);
try { runInContext(appJs, ctx, { filename: "snapshot-app.js" }); }
catch (e) { console.error("app.js threw in snapshot mode:", e.message); process.exit(1); }
const settle = () => new Promise(r => REAL_TIMEOUT(r, 0));
try { await ctx.tick(true); } catch (e) { RENDER_ERRORS.push("tick: " + e.message); }
await settle();

const pages = ["command", "case", "structure", "edge", "journal", "flow", "system"];
const count = (h, re) => (h.match(re) || []).length;
let bad = 0;
console.log(`snapshot ${FILE} · ${(html.length / 1024).toFixed(0)}kB · css ${(css.length / 1024).toFixed(0)}kB · state keys ${Object.keys(SNAP).length}`);
console.log(`assets: ${dataUris} data-URI refs · external /assets refs ${externals.length} · network calls ${NET}\n`);
if (externals.length) { console.log("✗ unstubbed asset refs: " + externals.slice(0, 3).join(", ")); bad++; }
if (NET) { console.log(`✗ snapshot mode made ${NET} network call(s)`); bad++; }

for (const page of pages) {
  COLLECT = [];
  try { ctx.go(page); } catch (e) { console.log(`${page.padEnd(10)} ✗ go() threw: ${e.message}`); bad++; continue; }
  await settle();
  const h = COLLECT.filter(w => w.id === "p-" + page).map(w => w.html).join("");
  const dv = [count(h, /<div\b/g), count(h, /<\/div>/g)];
  const canv = [...new Set([...h.matchAll(/id="(cv-[^"]+)"/g)].map(x => x[1]))];
  const probs = [];
  if (h.length < 1200) probs.push(`tiny (${h.length})`);
  if (dv[0] !== dv[1]) probs.push(`div ${dv[0]}/${dv[1]}`);
  if (/render error/.test(h)) probs.push("render-error block");
  if (page === "command" && count(h, /class="ach /g) < 6) probs.push("achievements missing");
  if (page === "journal" && count(h, /class="book /g) < 1) probs.push("book shelf missing");
  if (page === "system" && count(h, /class="mcard"/g) < 1) probs.push("asset bay missing");
  if (probs.length) bad++;
  console.log(`${probs.length ? "✗" : "✓"} ${page.padEnd(10)} ${String(h.length).padStart(6)} chars · canvases ${canv.length}${probs.length ? " · " + probs.join(" · ") : ""}`);
}
const errs = RENDER_ERRORS.filter(e => !/fetch/i.test(e));
if (errs.length) { console.log("\n✗ render errors: " + errs.slice(0, 3).join("; ")); bad++; }
console.log(bad ? `\n${bad} problem(s) in snapshot mode` : "\nsnapshot renders standalone — no server, no network");
process.exit(bad ? 1 : 0);
