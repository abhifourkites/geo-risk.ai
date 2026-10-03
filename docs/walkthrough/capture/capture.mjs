// Captures the product guide's 9 screenshots from the running app, read-only, and writes OUT/*.webp and
// OUT/manifest.json: each callout's box, from getBoundingClientRect, or for a map feature from MapLibre's
// projection of its real coordinates, at capture time.
//
// Safety: clicks on Confirm, Reject, Undo, "Load this company", "Check for new disasters" and "Find GLEIF candidates"
// are refused, and every request to /api/* that is not a GET is blocked (except POST /api/uploads: choosing a file
// on the upload page sends it, but nothing is loaded without "Load this company").
//
// Usage: npm install && BASE=http://localhost:5173 OUT=../assets node capture.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../../..");
const OUT = path.resolve(HERE, process.env.OUT ?? "../assets");
const BASE = process.env.BASE ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 1440, H = 900, DSF = 2;
const FORBIDDEN = ["Confirm", "Reject", "Undo", "Load this company", "Check for new disasters", "Find GLEIF candidates"];

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync("/tmp/walkthrough-");     // a fresh browser profile, removed at the end
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

// --- safety net: only GETs reach the API (and the upload of a chosen file) ---
const blocked = [];
const cdp = await page.target().createCDPSession();
await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
cdp.on("Fetch.requestPaused", async (e) => {
  const { method, url } = e.request;
  const ok = method === "GET" || method === "HEAD" || (method === "POST" && new URL(url).pathname === "/api/uploads");
  if (ok) await cdp.send("Fetch.continueRequest", { requestId: e.requestId }).catch(() => {});
  else { blocked.push(`${method} ${url}`); await cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
});

// --- helpers ---
async function clickHandle(h, what) {
  const text = (await h.evaluate((e) => (e.innerText || e.textContent || e.getAttribute("aria-label") || "").trim())).replace(/\s+/g, " ");
  if (FORBIDDEN.some((f) => text.startsWith(f))) throw new Error(`refusing to click "${text}" (${what})`);
  await h.click();
}
async function click(sel, text, { starts = false } = {}) {
  for (const h of await page.$$(sel)) {
    const t = (await h.evaluate((e) => (e.innerText || e.textContent || "").trim())).replace(/\s+/g, " ");
    if (text === undefined || t === text || (starts && t.startsWith(text))) return clickHandle(h, `${sel} ${text}`);
  }
  throw new Error(`nothing to click: ${sel} "${text}"`);
}
const waitText = (sel, text, timeout = 60000) => page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout }, sel, text);
// the MapLibre map, from MapView's map ref (React's fiber of the map container); read-only use
const MAP = `(() => { const el = document.querySelector(".maplibregl-map"); if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  for (let f = el[key]; f; f = f.return) for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) {
    const v = h.memoizedState?.current; if (v && typeof v.getMap === "function") return v.getMap(); }
  return null; })()`;
async function mapIdle(extra = 1200) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="map-loading"]') && !document.querySelector('[data-testid="style-loading"]'), { timeout: 60000 });
  await page.evaluate(`new Promise((r) => { const m = ${MAP}; if (!m) return r(); const t = setTimeout(r, 45000);
    const done = () => { clearTimeout(t); r(); }; if (m.loaded() && !m.isMoving()) done(); else m.once("idle", done); })`);
  await sleep(extra);
}
async function scrollTo(sel, top = 64) {
  await page.evaluate((s, off) => { const e = document.querySelector(s); window.scrollBy(0, e.getBoundingClientRect().top - off); }, sel, top);
  await sleep(400);
}
const toTop = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300); };
async function chooseCompany(name, { waitMap = true } = {}) {
  await page.click("#company"); await sleep(400);
  await click('[role="option"]', name);
  if (waitMap) { await page.waitForFunction((n) => document.querySelector("#summary-meta")?.textContent.startsWith(n), { timeout: 60000 }, name.replace(/\.$/, "")); await mapIdle(); }
  else await sleep(1500);
}
async function tab(label) { await click('[role="tab"]', label); await sleep(800); }

// A marker: { label, sel, text?, closest?, nth?, withLabel? } for a DOM element (withLabel: the box also takes in the
// element's <label>, which MUI draws on the field's border), or { label, map: "cluster" | "country:XX" | "event:ID" |
// "site:OSID" | "clear:XX,YY" } for a map feature. "clear:…" is a spot inside one of those countries (here the High
// ones) with nothing else drawn on it: no site, group or disaster area, and no toolbar or legend over the map.
async function boxes(markers) {
  return page.evaluate(async (markers, MAPSRC) => {
    const map = new Function(`return ${MAPSRC}`)();
    const out = [];
    for (const mk of markers) {
      let r = null;
      if (mk.sel) {
        let els = [...document.querySelectorAll(mk.sel)];
        if (mk.text) els = els.filter((e) => e.textContent.replace(/\s+/g, " ").includes(mk.text));
        let el = els[mk.nth ?? 0];
        if (el && mk.closest) el = el.closest(mk.closest);
        if (el) {
          const rs = [el.getBoundingClientRect()];
          if (mk.withLabel && el.querySelector("label")) rs.push(el.querySelector("label").getBoundingClientRect());
          const x1 = Math.min(...rs.map((b) => b.left)), y1 = Math.min(...rs.map((b) => b.top));
          const x2 = Math.max(...rs.map((b) => b.right)), y2 = Math.max(...rs.map((b) => b.bottom));
          r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, source: "dom" };
        }
      } else if (mk.map && map) {
        const c = map.getCanvas().getBoundingClientRect();
        const fromPts = (pts) => { const ps = pts.map((p) => map.project(p)); const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
          return { x: c.x + Math.min(...xs), y: c.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), source: "map" }; };
        const coords = (g) => g.type === "Point" ? [g.coordinates] : g.type === "Polygon" ? g.coordinates.flat() : g.type === "MultiPolygon" ? g.coordinates.flat(2) : [];
        const [kind, arg] = mk.map.split(":");
        if (kind === "cluster") {
          const f = map.queryRenderedFeatures({ layers: ["clusters"] }).sort((a, b) => b.properties.point_count - a.properties.point_count)[0];
          if (f) { const p = map.project(f.geometry.coordinates); const rad = 24; r = { x: c.x + p.x - rad, y: c.y + p.y - rad, w: 2 * rad, h: 2 * rad, source: "map", count: f.properties.point_count }; }
        } else if (kind === "country") {
          const fs = map.querySourceFeatures("countries").filter((f) => f.properties.ISO_A2_EH === arg);
          if (fs.length) r = fromPts(fs.flatMap((f) => coords(f.geometry)));
        } else if (kind === "event") {
          const fs = map.queryRenderedFeatures({ layers: ["disaster-fill"] }).filter((f) => f.properties.event_id === arg);
          if (fs.length) r = fromPts(fs.flatMap((f) => coords(f.geometry)));
        } else if (kind === "site") {
          const f = map.querySourceFeatures("sites").find((x) => x.properties.os_id === arg) ?? map.queryRenderedFeatures({ layers: ["selected-ring"] })[0];
          if (f) { const p = map.project(f.geometry.coordinates); r = { x: c.x + p.x - 14, y: c.y + p.y - 14, w: 28, h: 28, source: "map" }; }
        } else if (kind === "clear") {
          const want = arg.split(","), R = 18, canvas = map.getCanvas();
          const others = ["clusters", "cluster-count", "site", "highlight", "selected-ring", "disaster-fill", "disaster-line", "disaster-ring"].filter((l) => map.getLayer(l));
          const dots = map.queryRenderedFeatures({ layers: ["clusters", "site"] }).map((f) => map.project(f.geometry.coordinates));
          let best = null;
          for (let y = R + 4; y < c.height - R - 4; y += 4) for (let x = R + 4; x < c.width - R - 4; x += 4) {
            const pts = [[x, y], [x - R, y - R], [x + R, y - R], [x - R, y + R], [x + R, y + R]];
            if (!pts.every(([px, py]) => want.includes(map.queryRenderedFeatures([px, py], { layers: ["land"] })[0]?.properties.ISO_A2_EH))) continue;
            if (map.queryRenderedFeatures([[x - R - 6, y - R - 6], [x + R + 6, y + R + 6]], { layers: others }).length) continue;
            if (!pts.every(([px, py]) => document.elementFromPoint(c.x + px, c.y + py) === canvas)) continue;
            const room = Math.min(...dots.map((d) => Math.hypot(d.x - x, d.y - y)));     // the farthest from any site or group
            if (!best || room > best.room) best = { x, y, room, iso: map.queryRenderedFeatures([x, y], { layers: ["land"] })[0].properties.ISO_A2_EH };
          }
          if (best) r = { x: c.x + best.x - R, y: c.y + best.y - R, w: 2 * R, h: 2 * R, source: "map", country: best.iso };
        }
        if (r) { // keep a map feature's box inside the map
          const x2 = Math.min(r.x + r.w, c.x + c.width), y2 = Math.min(r.y + r.h, c.y + c.height);
          r.x = Math.max(r.x, c.x); r.y = Math.max(r.y, c.y); r.w = x2 - r.x; r.h = y2 - r.y;
        }
      }
      out.push(r ? { label: mk.label, ...r } : { label: mk.label, missing: true });
    }
    return out;
  }, markers, MAP);
}

const manifest = { shots: [] };
const MAPAREA = [{ sel: ".maplibregl-map" }, { sel: 'aside[aria-label="Details"]' }];   // the map and the panel beside it
const PANEL = 'aside[aria-label="Details"]';
// crop: marker-like specs whose union (plus 12 px) is the image, clamped to the viewport; none: the whole viewport
async function shot(name, title, markers, crop = null) {
  await page.mouse.move(1, 1); await sleep(300);   // no hover highlight left on the last item clicked
  const bx = await boxes(markers);
  for (const b of bx) {               // a line can be 0 px wide or high: grow it to 12 px, centred on its box
    if (!b.missing && b.w < 12) { b.x -= (12 - b.w) / 2; b.w = 12; }
    if (!b.missing && b.h < 12) { b.y -= (12 - b.h) / 2; b.h = 12; }
  }
  let c = { x: 0, y: 0, w: W, h: H };
  if (crop) {
    const cb = (await boxes(crop)).filter((b) => !b.missing);
    if (!cb.length) throw new Error(`${name}: crop not found`);
    const x1 = Math.max(0, Math.min(...cb.map((b) => b.x)) - 12), y1 = Math.max(0, Math.min(...cb.map((b) => b.y)) - 12);
    const x2 = Math.min(W, Math.max(...cb.map((b) => b.x + b.w)) + 12), y2 = Math.min(H, Math.max(...cb.map((b) => b.y + b.h)) + 12);
    c = { x: Math.floor(x1), y: Math.floor(y1), w: Math.ceil(x2 - x1), h: Math.ceil(y2 - y1) };
  }
  const off = bx.filter((b) => b.missing || b.x + b.w < c.x || b.y + b.h < c.y || b.x > c.x + c.w || b.y > c.y + c.h);
  if (off.length) throw new Error(`${name}: marker(s) not in the image: ${off.map((m) => `${m.label} ${JSON.stringify(m)}`).join(", ")}`);
  const file = `${name}.webp`;
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));   // clip is in page coordinates
  await page.screenshot({ path: path.join(OUT, file), type: "webp", quality: 95, captureBeyondViewport: false,
    clip: { x: c.x + scroll.x, y: c.y + scroll.y, width: c.w, height: c.h } });
  const round = (v) => Math.round(v * 10) / 10;
  const rel = (b) => {                // the marker's box in the image, clipped to it
    const x1 = Math.max(b.x, c.x), y1 = Math.max(b.y, c.y), x2 = Math.min(b.x + b.w, c.x + c.w), y2 = Math.min(b.y + b.h, c.y + c.h);
    return { x: round(x1 - c.x), y: round(y1 - c.y), w: round(x2 - x1), h: round(y2 - y1) };
  };
  const extra = (b) => Object.fromEntries(["count", "country"].filter((k) => b[k] != null).map((k) => [k, b[k]]));
  manifest.shots.push({ name, file, title, width: c.w, height: c.h, scale: DSF, viewport_crop: c,
    markers: bx.map((b, i) => ({ n: i + 1, label: b.label, ...rel(b), source: b.source, ...extra(b) })) });
  console.log(`  ${file}: ${c.w}x${c.h}, ${bx.length} markers`);
}

// --- capture ---
console.log(`capturing ${BASE} into ${OUT}`);
await page.goto(BASE, { waitUntil: "networkidle0", timeout: 90000 });
await page.waitForFunction(() => document.querySelector("#disaster-status")?.textContent.startsWith("Disaster data:"), { timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#summary-meta")?.textContent.startsWith("adidas"), { timeout: 60000 });
await mapIdle(2000);
const now = new Date();
manifest.captured = {
  at_utc: now.toISOString(), at_local: now.toString(), base: BASE, viewport: `${W}x${H}`, scale: DSF,
  disaster_data_chip: await page.$eval("#disaster-status", (e) => e.textContent.trim()),
  app_commit: execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(),
  chrome: await browser.version(),
};
console.log(manifest.captured);
const highCountries = await page.evaluate(async () =>
  (await (await fetch("/api/customers/adidas/view?high=10&watch=5")).json()).countries.filter((c) => c.level === "High").map((c) => c.country_code));

// 1. overview: the top bar, the summary sentence and the three cards (adidas)
await toTop();
await shot("01-overview", "Overview (adidas)", [
  { label: "Company", sel: "#company", closest: ".MuiFormControl-root" },
  { label: "Disaster data", sel: "#disaster-status" },
  { label: "Summary sentence", sel: "#summary-sentence" },
  { label: "Answer cards", sel: '[aria-label="Answers"]' },
], [{ sel: "header" }, { sel: '[aria-label="Summary"]' }, { sel: '[aria-label="Answers"]' }]);
// 2. the map, Plain, flat
await scrollTo(".maplibregl-map", 120);
await shot("03-map", "The map: Plain style, flat (adidas)", [
  { label: "Toolbar", sel: '[aria-label="Map projection"]', closest: ".MuiPaper-root" },
  { label: "Group of sites", map: "cluster" },
  { label: "High country", map: `clear:${highCountries.join(",")}` },
  { label: "Disaster area", map: "event:DR1018332" },
], MAPAREA);
// 4. owner panel (adidas): Owner companies table -> POU CHEN
await scrollTo('[aria-label="Tables"]', 64);
await click('[role="tab"]', "Owner companies"); await sleep(800);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "POU CHEN"); await mapIdle(1500);
await scrollTo(".maplibregl-map", 120);
await shot("10b-owner-panel", "Owner panel: POU CHEN (adidas)", [
  { label: "Share and level", sel: `${PANEL} h2`, closest: "div" },
  { label: "Sites and countries", sel: `${PANEL} p`, text: "sites in" },
  { label: "Its sites", sel: `${PANEL} h3`, text: "Its sites", closest: "section" },
], MAPAREA);
// 9. Satellite, on adidas's Vietnam panel (Countries table -> Vietnam; Map, then Satellite)
await scrollTo('[aria-label="Tables"]', 64);
await click('[role="tab"]', "Countries"); await sleep(800);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "Vietnam"); await mapIdle(1500);
await scrollTo(".maplibregl-map", 120);
await click('[aria-label="Map style"] button', "Map"); await mapIdle(3000);
await click('[aria-label="Map style"] button', "Satellite"); await mapIdle(4000);
await shot("06-style-satellite", 'Map style "Satellite" (adidas, Vietnam)', [
  { label: "Satellite", sel: '[aria-label="Map style"] button', text: "Satellite" },
  { label: "Credits", sel: ".maplibregl-ctrl-attrib" },
  { label: "Vietnam", map: "country:VN" },
], MAPAREA);
await click('[aria-label="Map style"] button', "Plain"); await mapIdle();
// 6. how the numbers are worked out
await scrollTo("#how-header", 64);
await page.click("#how-header"); await sleep(800);
await page.click("#source-header"); await sleep(800);
await scrollTo("#how-header", 64);
await shot("12a-how", "How these numbers are worked out (adidas)", [
  { label: "High at (%)", sel: "label", text: "High at (%)", closest: ".MuiFormControl-root", withLabel: true },
  { label: "Watch at (%)", sel: "label", text: "Watch at (%)", closest: ".MuiFormControl-root", withLabel: true },
  { label: "Coverage", sel: ".MuiAccordionDetails-root p", text: "Coverage." },
], [{ sel: "#how-header", closest: ".MuiAccordion-root" }]);
// 3. site panel: Nike's PT. Paxar Indonesia (Countries table -> Indonesia -> the site)
await toTop();
await chooseCompany("Nike");
await scrollTo('[aria-label="Tables"]', 64);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "Indonesia"); await mapIdle();
await click(`${PANEL} .MuiListItemText-primary`, "PT. Paxar Indonesia"); await mapIdle(2500);
await waitText(`${PANEL} h2`, "PT. Paxar Indonesia");
await scrollTo(".maplibregl-map", 120);
await shot("08-site-panel", "Site panel: PT. Paxar Indonesia (Nike)", [
  { label: "Owner companies", sel: `${PANEL} h3`, text: "Owner companies", closest: "section" },
  { label: "Disaster area", sel: `${PANEL} h3`, text: "Disaster area", closest: "section" },
  { label: "Parent company", sel: `${PANEL} h3`, text: "Parent company", closest: "section" },
  { label: "The site on the map", map: "site:ID2021182JC36SX" },
], MAPAREA);
// 5. disaster panel: Amazon's drought, scrolled to the sites that are inside the area but not counted
await toTop();
await chooseCompany("Amazon.com, Inc.");
await page.click('[data-card="disasters"] button'); await sleep(800);
await click(`${PANEL} .MuiListItemText-primary`, "Drought in", { starts: true }); await mapIdle(2000);
await waitText(`${PANEL} h2`, "Drought");
await scrollTo(".maplibregl-map", 120);
await page.evaluate((t) => { const c = document.querySelector('aside[aria-label="Details"] .MuiCardContent-root');
  const h = [...c.querySelectorAll("h3")].find((x) => x.textContent.startsWith(t)); c.scrollTop += h.getBoundingClientRect().top - c.getBoundingClientRect().top - 12; },
  "Inside the area, but GDACS does not list"); await sleep(500);
await shot("09c-disaster-unlisted", "Disaster panel: drought DR1018332, not counted (Amazon)", [
  { label: "Inside the area, not counted", sel: `${PANEL} h3`, text: "Inside the area, but GDACS does not list", closest: "section" },
  { label: "United Kingdom", map: "country:GB" },
  { label: "The drought's area", map: "event:DR1018332" },
], MAPAREA);
// 7. upload: data/demo/amazon.csv chosen, not loaded
await toTop();
await tab("Upload a supplier list");
await (await page.$('.upload input[type="file"]')).uploadFile(path.join(REPO, "data/demo/amazon.csv"));
await waitText(".upload p", "rows in the file", 120000); await sleep(800);
await shot("14b-upload-amazon", "Upload: data/demo/amazon.csv chosen (not loaded)", [
  { label: "Rows and lists", sel: ".upload p", text: "rows in the file" },
  { label: "Company found", sel: '[data-testid="company-found"]' },
  { label: "The 2026 list: ticked and current", sel: ".upload tbody tr", text: "Amazon Facility List 2026" },
], [{ sel: ".upload" }]);
// 8. company network: Nike's PT. Paxar Indonesia, confirmed
await tab("Company network");
await chooseCompany("Nike", { waitMap: false });
await page.waitForSelector('[data-testid^="candidate-"]', { timeout: 60000 });
await toTop();
await page.type("#network-search", "Paxar"); await sleep(800);
await click('[data-testid^="candidate-"] [role="button"]', "PT. Paxar Indonesia", { starts: true });
await page.waitForFunction(() => document.querySelector('[aria-label="Graph"] .MuiTypography-subtitle2')?.textContent.startsWith("PT. Paxar Indonesia"), { timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="network-graph"] .react-flow__node').length > 2, { timeout: 60000 }); await sleep(1500);
await page.waitForSelector('[data-testid="network-graph"] .react-flow__edge-path[style*="stroke-width: 2.25"]', { timeout: 30000 }); await sleep(800);
await shot("15b-network-paxar", "Company network: PT. Paxar Indonesia, confirmed (Nike)", [
  { label: "Confirm / Reject / Undo (not clicked)", sel: '[data-testid^="candidate-"] button', closest: ".MuiStack-root" },
  { label: "Confirmed", sel: '[aria-label="Graph"] .MuiChip-root' },
  { label: "Solid line: confirmed", sel: '[data-testid="network-graph"] .react-flow__edge-path[style*="stroke-width: 2.25"]' },
  { label: "Parent company", sel: '[data-testid="network-graph"] .react-flow__node', text: "AVERY DENNISON CORPORATION" },
], [{ sel: "main" }]);

// the guide's order
const ORDER = ["01-overview", "03-map", "08-site-panel", "10b-owner-panel", "09c-disaster-unlisted", "12a-how", "14b-upload-amazon", "15b-network-paxar", "06-style-satellite"];
manifest.shots.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
manifest.blocked_requests = blocked;
manifest.console_errors = consoleErrors;
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`done: ${manifest.shots.length} screenshots; blocked API writes: ${blocked.length}; console errors: ${consoleErrors.length}`);
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
