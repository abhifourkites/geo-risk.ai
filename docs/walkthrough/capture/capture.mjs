// Captures the product guide's screenshots from the running app, read-only, and writes ../assets/*.webp and
// ../assets/manifest.json (each marker's box, from getBoundingClientRect, or for a map feature from MapLibre's
// projection of its real coordinates, at capture time).
//
// Safety: clicks on Confirm, Reject, Undo, "Load this company", "Check for new disasters" and "Find GLEIF candidates"
// are refused, and every request to /api/* that is not a GET is blocked (except POST /api/uploads: choosing a file
// on the upload page sends it, but nothing is loaded without "Load this company").
//
// Usage: npm install && BASE=http://localhost:5173 node capture.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../../..");
const OUT = path.resolve(HERE, "../assets");
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
async function click(sel, text, { starts = false, within = null } = {}) {
  for (const h of await page.$$(within ? `${within} ${sel}` : sel)) {
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
async function chooseCompany(name, { waitMap = true } = {}) {
  await page.click("#company"); await sleep(400);
  await click('[role="option"]', name);
  if (waitMap) { await page.waitForFunction((n) => document.querySelector("#summary-meta")?.textContent.startsWith(n), { timeout: 60000 }, name.replace(/\.$/, "")); await mapIdle(); }
  else await sleep(1500);
}
async function tab(label) { await click('[role="tab"]', label); await sleep(800); }

// A marker: { label, sel, text?, closest?, nth? } for a DOM element, or { label, map: "cluster" | "country:XX" | "event:ID" | "site:OSID" | "otherEvent:ID" }.
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
        if (el) { const b = el.getBoundingClientRect(); r = { x: b.x, y: b.y, w: b.width, h: b.height, source: "dom" }; }
      } else if (mk.map && map) {
        const c = map.getCanvas().getBoundingClientRect();
        const fromPts = (pts) => { const ps = pts.map((p) => map.project(p)); const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
          return { x: c.x + Math.min(...xs), y: c.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), source: "map" }; };
        const coords = (g) => g.type === "Point" ? [g.coordinates] : g.type === "Polygon" ? g.coordinates.flat() : g.type === "MultiPolygon" ? g.coordinates.flat(2) : [];
        const [kind, arg] = mk.map.split(":");
        if (kind === "cluster") {
          const f = map.queryRenderedFeatures({ layers: ["clusters"] }).sort((a, b) => b.properties.point_count - a.properties.point_count)[0];
          if (f) { const p = map.project(f.geometry.coordinates); const rad = 24; r = { x: c.x + p.x - rad, y: c.y + p.y - rad, w: 2 * rad, h: 2 * rad, source: "map" }; }
        } else if (kind === "country") {
          const fs = map.querySourceFeatures("countries").filter((f) => f.properties.ISO_A2_EH === arg);
          if (fs.length) r = fromPts(fs.flatMap((f) => coords(f.geometry)));
        } else if (kind === "event" || kind === "otherEvent") {
          const fs = map.queryRenderedFeatures({ layers: ["disaster-fill"] }).filter((f) => kind === "event" ? f.properties.event_id === arg : f.properties.event_id !== arg);
          const pick = kind === "event" ? fs : fs.slice(0, 1).flatMap((f) => fs.filter((g) => g.properties.event_id === f.properties.event_id));
          if (pick.length) r = fromPts(pick.flatMap((f) => coords(f.geometry)));
          if (r) r.event = pick[0].properties.event_id;
        } else if (kind === "site") {
          const f = map.querySourceFeatures("sites").find((x) => x.properties.os_id === arg) ?? map.queryRenderedFeatures({ layers: ["selected-ring"] })[0];
          if (f) { const p = map.project(f.geometry.coordinates); r = { x: c.x + p.x - 14, y: c.y + p.y - 14, w: 28, h: 28, source: "map" }; }
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
// crop: marker-like specs whose union (plus 12 px) is the image, clamped to the viewport; none: the whole viewport
async function shot(name, title, markers = [], crop = null) {
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
  manifest.shots.push({ name, file, title, width: c.w, height: c.h, scale: DSF, viewport_crop: c,
    markers: bx.map((b, i) => ({ n: i + 1, label: b.label, ...rel(b), source: b.source, ...(b.event ? { event: b.event } : {}) })) });
  console.log(`  ${file}: ${c.w}x${c.h}, ${bx.length} markers`);
}

// --- capture ---
console.log(`capturing ${BASE}`);
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

// 1. header and tabs
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await shot("01-header", "Header and tabs (adidas)", [
  { label: "Company", sel: "#company", closest: ".MuiFormControl-root" },
  { label: "Disaster data", sel: "#disaster-status" },
  { label: "Check for new disasters", sel: "button", text: "Check for new disasters" },
  { label: "Pages", sel: '[aria-label="Pages"]' },
], [{ sel: "header" }]);
// 2. summary and cards
await shot("02-summary", "The summary sentence and the three answer cards", [
  { label: "Company and sites", sel: "#summary-meta" },
  { label: "Summary sentence", sel: "#summary-sentence" },
  { label: "Countries", sel: '[data-card="countries"]' },
  { label: "Owner companies", sel: '[data-card="owners"]' },
  { label: "Disasters now", sel: '[data-card="disasters"]' },
], [{ sel: '[aria-label="Summary"]' }, { sel: '[aria-label="Answers"]' }]);
// 3. the map, Plain, flat
await scrollTo(".maplibregl-map", 120);
await shot("03-map", "The map: Plain style, flat", [
  { label: "Show all current disasters", sel: "label", text: "Show all current disasters" },
  { label: "Flat map / Globe view", sel: '[aria-label="Map projection"]' },
  { label: "Plain / Map / Satellite", sel: '[aria-label="Map style"]' },
  { label: "Reset view", sel: "button", text: "Reset view" },
  { label: "Zoom and compass", sel: ".maplibregl-ctrl-group" },
  { label: "Group of sites", map: "cluster" },
  { label: "High country", map: "country:VN" },
  { label: "Disaster area", map: "event:DR1018332" },
  { label: "Legend", sel: '[aria-label="Map legend"]', nth: 0 },
  { label: "Details panel", sel: 'aside[aria-label="Details"]' },
], MAPAREA);
// 4. globe
await click('[aria-label="Map projection"] button', "Globe view"); await mapIdle(1500);
await shot("04-globe", "Globe view", [
  { label: "Globe view", sel: '[aria-label="Map projection"] button', text: "Globe view" },
  { label: "Reset view", sel: "button", text: "Reset view" },
], MAPAREA);
await click('[aria-label="Map projection"] button', "Flat map"); await mapIdle();
// 7. Show all current disasters (before zooming in)
await click("button", "Reset view"); await mapIdle();
await click("label", "Show all current disasters"); await mapIdle(1500);
await shot("07-show-all", "Show all current disasters, turned on", [
  { label: "Show all current disasters", sel: "label", text: "Show all current disasters" },
  { label: "An area with none of your sites", map: "otherEvent:DR1018332" },
], MAPAREA);
await click("label", "Show all current disasters"); await mapIdle();
// 11. tables, and 10. country and owner panels (adidas)
await scrollTo('[aria-label="Tables"]', 64);
await shot("11a-countries-table", "Countries table", [
  { label: "Countries / Owner companies", sel: '[aria-label="Tables"]' },
  { label: "Search", sel: '[role="tabpanel"]:not([hidden]) input[role="searchbox"]', closest: ".MuiInputBase-root" },
  { label: "Sorted by Share", sel: '.MuiDataGrid-columnHeader[data-field="share"]' },
  { label: "Vietnam row", sel: ".MuiDataGrid-row", text: "Vietnam" },
  { label: "Rows and pages", sel: ".MuiTablePagination-root" },
], [{ sel: '[aria-label="Tables"]', closest: ".MuiCard-root" }]);
await click('[role="tab"]', "Owner companies"); await sleep(800);
await shot("11b-owners-table", "Owner companies table", [
  { label: "Owner companies", sel: '[role="tab"]', text: "Owner companies" },
  { label: "POU CHEN row", sel: ".MuiDataGrid-row", text: "POU CHEN" },
  { label: "Countries column", sel: '.MuiDataGrid-columnHeader[data-field="countriesText"]' },
], [{ sel: '[aria-label="Tables"]', closest: ".MuiCard-root" }]);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "POU CHEN"); await mapIdle(1500);
await scrollTo(".maplibregl-map", 120);
await shot("10b-owner-panel", "Owner panel: POU CHEN (adidas)", [
  { label: "Share and level", sel: 'aside[aria-label="Details"] h2', closest: "div" },
  { label: "Its sites", sel: 'aside[aria-label="Details"] h3', text: "Its sites", closest: "section" },
], MAPAREA);
await scrollTo('[aria-label="Tables"]', 64);
await click('[role="tab"]', "Countries"); await sleep(800);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "Vietnam"); await mapIdle(1500);
await scrollTo(".maplibregl-map", 120);
await shot("10a-country-panel", "Country panel: Vietnam (adidas)", [
  { label: "Share and level", sel: 'aside[aria-label="Details"] h2', closest: "div" },
  { label: "Sites", sel: 'aside[aria-label="Details"] h3', text: "Sites", closest: "section" },
  { label: "Vietnam outlined", map: "country:VN" },
], MAPAREA);
// 5. and 6. map styles, on Vietnam
await click('[aria-label="Map style"] button', "Map"); await mapIdle(3000);
await shot("05-style-map", 'Map style "Map": place names', [
  { label: "Map", sel: '[aria-label="Map style"] button', text: "Map" },
  { label: "Credits", sel: ".maplibregl-ctrl-attrib" },
], MAPAREA);
await click('[aria-label="Map style"] button', "Satellite"); await mapIdle(4000);
await shot("06-style-satellite", 'Map style "Satellite"', [
  { label: "Satellite", sel: '[aria-label="Map style"] button', text: "Satellite" },
  { label: "Credits", sel: ".maplibregl-ctrl-attrib" },
], MAPAREA);
await click('[aria-label="Map style"] button', "Plain"); await mapIdle();
// 12. how the numbers are worked out; source and limits
await scrollTo("#how-header", 64);
await page.click("#how-header"); await sleep(800);
await page.click("#source-header"); await sleep(800);
await scrollTo("#how-header", 64);
await shot("12a-how", "How these numbers are worked out", [
  { label: "High at (%)", sel: "label", text: "High at (%)", closest: ".MuiFormControl-root" },
  { label: "Watch at (%)", sel: "label", text: "Watch at (%)", closest: ".MuiFormControl-root" },
  { label: "Coverage", sel: "#how-header ~ * p, .MuiAccordionDetails-root p", text: "Coverage." },
], [{ sel: "#how-header", closest: ".MuiAccordion-root" }]);
await scrollTo("#source-header", 64);
await shot("12b-source", "Source and limits of the data", [
  { label: "Disaster data source", sel: ".MuiAccordionDetails-root p", text: "Disaster data:" },
  { label: "Your lists", sel: ".MuiAccordionDetails-root p", text: "Your lists" },
], [{ sel: "#source-header", closest: ".MuiAccordion-root" }]);
// 13. a company switch: "Loading <company>…" (the view request is slowed in this browser only)
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 4000, downloadThroughput: -1, uploadThroughput: -1 });
await chooseCompany("Nike", { waitMap: false });
await page.waitForSelector('[data-testid="view-loading"]', { timeout: 10000 });
await shot("13-loading", "A company switch: Loading Nike…", [
  { label: "Company", sel: "#company", closest: ".MuiFormControl-root" },
  { label: "Loading Nike…", sel: '[data-testid="view-loading"]' },
], [{ sel: "header" }, { sel: '[data-testid="view-loading"]' }]);
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await page.waitForFunction(() => document.querySelector("#summary-meta")?.textContent.startsWith("Nike"), { timeout: 60000 });
await mapIdle();
// 8. site panel: Nike's PT. Paxar Indonesia (Countries table -> Indonesia -> the site)
await scrollTo('[aria-label="Tables"]', 64);
await click(".MuiDataGrid-row .MuiDataGrid-cell", "Indonesia"); await mapIdle();
await click('aside[aria-label="Details"] .MuiListItemText-primary', "PT. Paxar Indonesia"); await mapIdle(2500);
await waitText('aside[aria-label="Details"] h2', "PT. Paxar Indonesia");
await scrollTo(".maplibregl-map", 120);
await shot("08-site-panel", "Site panel: PT. Paxar Indonesia (Nike)", [
  { label: "Owner companies", sel: 'aside[aria-label="Details"] h3', text: "Owner companies", closest: "section" },
  { label: "Disaster area", sel: 'aside[aria-label="Details"] h3', text: "Disaster area", closest: "section" },
  { label: "On your lists", sel: 'aside[aria-label="Details"] h3', text: "On your lists", closest: "section" },
  { label: "Parent company", sel: 'aside[aria-label="Details"] h3', text: "Parent company", closest: "section" },
  { label: "The site on the map", map: "site:ID2021182JC36SX" },
], MAPAREA);
// 9. disaster panel: Amazon's drought
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await chooseCompany("Amazon.com, Inc.");
await page.click('[data-card="disasters"] button'); await sleep(800);
await click('aside[aria-label="Details"] .MuiListItemText-primary', "Drought in", { starts: true }); await mapIdle(2000);
await waitText('aside[aria-label="Details"] h2', "Drought");
await scrollTo(".maplibregl-map", 120);
const panelTo = async (h3text) => { await page.evaluate((t) => { const c = document.querySelector('aside[aria-label="Details"] .MuiCardContent-root');
  const h = [...c.querySelectorAll("h3")].find((x) => x.textContent.startsWith(t)); c.scrollTop += h.getBoundingClientRect().top - c.getBoundingClientRect().top - 12; }, h3text); await sleep(500); };
await shot("09a-disaster-panel", "Disaster panel: drought DR1018332 (Amazon)", [
  { label: "Alert and level", sel: 'aside[aria-label="Details"] h2', closest: "div" },
  { label: "Your sites inside", sel: 'aside[aria-label="Details"] h3', text: "Your sites inside", closest: "section" },
  { label: "The drought's area", map: "event:DR1018332" },
], MAPAREA);
await panelTo("Their owners");
await shot("09b-disaster-owners", "Their owners, and those owners' other sites (Amazon)", [
  { label: "Their owners", sel: 'aside[aria-label="Details"] h3', text: "Their owners", closest: "section" },
  { label: "Those owners' other sites", sel: 'aside[aria-label="Details"] h3', text: "Those owners' other sites", closest: "section" },
], MAPAREA);
await panelTo("Inside the area, but GDACS does not list");
await shot("09c-disaster-unlisted", "Inside the area, but not counted (Amazon)", [
  { label: "Inside the area, not counted", sel: 'aside[aria-label="Details"] h3', text: "Inside the area, but GDACS does not list", closest: "section" },
], MAPAREA);
// the same drought for Apple, whose owners have other sites
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await chooseCompany("Apple");
await page.click('[data-card="disasters"] button'); await sleep(800);
await click('aside[aria-label="Details"] .MuiListItemText-primary', "Drought in", { starts: true }); await mapIdle(2000);
await scrollTo(".maplibregl-map", 120);
await panelTo("Those owners' other sites");
await shot("09d-disaster-other-sites", "Those owners' other sites (Apple, the same drought)", [
  { label: "Those owners' other sites", sel: 'aside[aria-label="Details"] h3', text: "Those owners' other sites", closest: "section" },
], MAPAREA);
// 14. upload: empty page, amazon.csv chosen, facilities.csv chosen; nothing loaded
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await tab("Upload a supplier list");
await shot("14a-upload-empty", "Upload a supplier list", [
  { label: "The three steps", sel: ".upload ol" },
  { label: "Choose a file", sel: ".upload label", text: "Choose a file" },
], [{ sel: ".upload" }]);
const fileInput = async () => page.$('.upload input[type="file"]');
await (await fileInput()).uploadFile(path.join(REPO, "data/demo/amazon.csv"));
await waitText(".upload p", "rows in the file", 120000); await sleep(800);
await shot("14b-upload-amazon", "data/demo/amazon.csv chosen (not loaded)", [
  { label: "Rows and lists", sel: ".upload p", text: "rows in the file" },
  { label: "Company found", sel: '[data-testid="company-found"]' },
  { label: "Ticked and current", sel: ".upload p", text: "Ticked:" },
  { label: "The 2026 list: ticked and current", sel: ".upload tbody tr", text: "Amazon Facility List 2026" },
], [{ sel: ".upload" }]);
await scrollTo("#company-name", 500);
await shot("14c-upload-amazon-name", "data/demo/amazon.csv chosen: the company name (not loaded)", [
  { label: "Company name", sel: "#company-name", closest: ".MuiFormControl-root" },
  { label: "Load this company (not clicked)", sel: ".upload button", text: "Load this company" },
], [{ sel: ".upload" }]);
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await (await fileInput()).uploadFile(path.join(REPO, "data/demo/facilities.csv"));
await page.waitForSelector('[data-testid="suggestions"]', { timeout: 120000 }); await sleep(800);
await shot("14d-upload-facilities", "data/demo/facilities.csv chosen: suggestions (not loaded)", [
  { label: "Rows and lists", sel: ".upload p", text: "rows in the file" },
  { label: "Suggested companies", sel: '[data-testid="suggestions"]' },
  { label: "Search and Show all lists", sel: "#list-search", closest: ".MuiStack-root" },
], [{ sel: ".upload" }]);
// 15. company network
await chooseCompany("adidas", { waitMap: false });
await tab("Company network");
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await page.waitForSelector('[data-testid^="candidate-"]', { timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="network-graph"] .react-flow__node').length > 2, { timeout: 60000 });
await page.waitForSelector('[data-testid="network-graph"] .react-flow__edge-path[style*="dasharray"]', { timeout: 30000 }); await sleep(1500);
await shot("15a-network-adidas", "Company network: adidas, a candidate not decided", [
  { label: "Candidates and verdicts", sel: 'main [role="status"]' },
  { label: "Review level", sel: "#level-label", closest: ".MuiFormControl-root" },
  { label: "Search names or LEI", sel: "#network-search", closest: ".MuiFormControl-root" },
  { label: "A candidate", sel: '[data-testid^="candidate-"]' },
  { label: "Confirm / Reject / Undo (not clicked)", sel: '[data-testid^="candidate-"] button', closest: ".MuiStack-root" },
  { label: "Dashed line: not confirmed", sel: '[data-testid="network-graph"] .react-flow__edge-path[style*="dasharray"]' },
], [{ sel: "main" }]);
const openCandidate = async (company, query, rowText) => {
  await chooseCompany(company, { waitMap: false });
  await page.waitForSelector('[data-testid^="candidate-"]', { timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await page.type("#network-search", query); await sleep(800);
  await click('[data-testid^="candidate-"] [role="button"]', rowText, { starts: true });
  await page.waitForFunction((t) => document.querySelector('[aria-label="Graph"] .MuiTypography-subtitle2')?.textContent.startsWith(t), { timeout: 60000 }, rowText);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="network-graph"] .react-flow__node').length > 2, { timeout: 60000 }); await sleep(1500);
};
await openCandidate("Nike", "Paxar", "PT. Paxar Indonesia");
await page.waitForSelector('[data-testid="network-graph"] .react-flow__edge-path[style*="stroke-width: 2.25"]', { timeout: 30000 }); await sleep(800);
await shot("15b-network-paxar", "Company network: PT. Paxar Indonesia (Nike), confirmed", [
  { label: "Confirmed", sel: '[aria-label="Graph"] .MuiChip-root' },
  { label: "Solid line: confirmed", sel: '[data-testid="network-graph"] .react-flow__edge-path[style*="stroke-width: 2.25"]' },
  { label: "Parent companies", sel: '[data-testid="network-graph"] .react-flow__node', text: "AVERY DENNISON CORPORATION" },
], [{ sel: "main" }]);
await openCandidate("Apple", "HENKEL", "HENKEL AG AND KGAA");
await shot("15c-network-henkel", "Company network: HENKEL AG AND KGAA (Apple), a shared verdict", [
  { label: "Shared verdict", sel: '[data-testid="shared"]' },
  { label: "Your company: Apple only", sel: '[data-testid="network-graph"] .react-flow__node', text: "Apple" },
], [{ sel: "main" }]);
await chooseCompany("Samsung", { waitMap: false });
await page.waitForSelector('[data-testid="no-candidates"]', { timeout: 60000 }); await sleep(800);
await shot("15d-network-samsung", "Company network: Samsung, no candidates yet", [
  { label: "No candidates yet", sel: '[data-testid="no-candidates"]' },
  { label: "Find GLEIF candidates (not clicked)", sel: '[data-testid="no-candidates"] button' },
], [{ sel: "main" }]);

manifest.blocked_requests = blocked;
manifest.console_errors = consoleErrors;
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`done: ${manifest.shots.length} screenshots; blocked API writes: ${blocked.length}; console errors: ${consoleErrors.length}`);
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
