// Builds ../index.html from ../assets/manifest.json (written by capture.mjs) and the guide's text below.
// Each callout points at a box measured on the page at capture time (manifest); only where its label sits is chosen
// here, in empty space, with a line to the box. Text describes what the screenshots show; "Code only" marks
// behaviour taken from the app's source code.
//
// Usage: node build.mjs
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/manifest.json"), "utf8"));
const shots = Object.fromEntries(manifest.shots.map((s) => [s.name, s]));
const cap = manifest.captured;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = new Date(cap.at_utc);
const pad = (n) => String(n).padStart(2, "0");
const capturedUtc = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
const chipTime = cap.disaster_data_chip.replace(/^Disaster data: \d+ \w+ \d+, /, "");     // e.g. "12:38 UTC"
const chrome = cap.chrome.replace(/^HeadlessChrome\/|^Chrome\//, "").split(".")[0];

// --- the guide: 9 figures; each callout: [marker n, text on the callout, centre of the callout in image px, options] ---
// A centre above the image (y < 0) puts the callout in a strip above it. outline: false draws only the line, which
// ends on the box's edge (for a box that would cross a label or other controls).
const FIGURES = [
  {
    shot: "01-overview", title: "Overview", company: "adidas",
    callouts: [
      [1, "Pick a company: every number updates", [290, -24], { outline: false }],
      [2, "When disaster data was last read", [852, 32]],
      [3, "The answer in one sentence", [1284, 200]],
      [4, "Click a card to highlight its sites", [708, 450]],
    ],
    text: `The top bar holds the company, the time of the last disaster check, Check for new disasters (not clicked here) and three pages: Risk map, Upload a supplier list and Company network. Below it, the summary sentence and three cards answer where adidas is exposed.`,
  },
  {
    shot: "03-map", title: "The map", company: "adidas",
    callouts: [
      [1, "Show all disasters, globe, style, reset", [228, -24]],
      [2, "226 sites here: click to zoom in", [1140, 239]],
      [3, "High: 10% or more of workers", [1122, 150]],
      [4, "Drought area: 17 of your sites", [232, 120]],
    ],
    text: `Countries at High are red and at Watch amber, nearby sites are grouped with their count, and disaster areas are outlined in purple. The legend at the bottom left explains each colour and symbol. Clicking a site, a country or a disaster area opens its details in the panel on the right.`,
  },
  {
    shot: "08-site-panel", title: "The site panel: PT. Paxar Indonesia", company: "Nike",
    callouts: [
      [1, "Owner company, from Open Supply Hub", [720, 120]],
      [2, "Not inside a current disaster area", [720, 190]],
      [3, "GLEIF parent, once a person confirms", [752, 445]],
      [4, "The selected site on the map", [470, 230]],
    ],
    text: `A site's panel lists its owner, warnings, disaster status, the lists it is on and its parent company. It was opened from Nike's Countries table: Indonesia, then this site. It is on Nike's February 2024 list and has about 334 workers.`,
  },
  {
    shot: "10b-owner-panel", title: "The owner panel: POU CHEN", company: "adidas",
    callouts: [
      [1, "7.4% of workers: Watch level", [1240, 56]],
      [2, "9 sites in 4 countries", [800, 140]],
      [3, "Its sites, highlighted on the map", [1222, 212]],
    ],
    text: `Opened by clicking POU CHEN in the Owner companies table below the map. It shows what share of adidas's suppliers' workers the owner holds, and where its sites are.`,
  },
  {
    shot: "09c-disaster-unlisted", title: "The disaster panel: the drought", company: "Amazon.com, Inc.",
    callouts: [
      [1, "Inside the area, but not counted", [1176, -24]],
      [2, "UK: not on GDACS's affected list", [216, 105]],
      [3, "The drought's affected area", [720, 150]],
    ],
    text: `Opened from the Disasters now card, then scrolled down. These 47 sites in the United Kingdom are inside the drought's area but not counted: GDACS lists 29 countries as affected, and the United Kingdom is not one of them.`,
  },
  {
    shot: "12a-how", title: "How these numbers are worked out", company: "adidas",
    callouts: [
      [1, "Change the High threshold", [1000, 236]],
      [2, "Change the Watch threshold", [1000, 272]],
      [3, "Each number shows its base", [952, 170]],
    ],
    text: `Shares use suppliers' workers because workers are known for at least 90% of sites (719 of 766 here). <span class="code">Code only</span> Changing a threshold recalculates the country and owner levels; it is not saved.`,
  },
  {
    shot: "14b-upload-amazon", title: "Upload: Amazon's file, pre-filled", company: "",
    callouts: [
      [1, "3798 rows naming 980 lists", [1180, 229]],
      [2, "Company found on every row", [1180, 276]],
      [3, "Latest list ticked and marked current", [900, 579]],
    ],
    text: `Choosing an Open Supply Hub file (here <code>data/demo/amazon.csv</code>) fills in the company and ticks its newest list; personal contact columns (claim_*) are dropped. Nothing is loaded until the lists and the name are checked and loaded, which was not done here.`,
  },
  {
    shot: "15b-network-paxar", title: "Company network: PT. Paxar Indonesia confirmed", company: "Nike",
    callouts: [
      [1, "Confirm or reject each candidate", [900, 300]],
      [2, "Confirmed by a person", [1240, 140]],
      [3, "Solid line: a confirmed match", [1000, 440]],
      [4, "GLEIF parent: AVERY DENNISON CORPORATION", [1000, 505]],
    ],
    text: `A match between an Open Supply Hub name and a GLEIF company stays a candidate (dashed line) until a person confirms it. Only then does its parent company show, here and in the site panel (figure 3).`,
  },
  {
    shot: "06-style-satellite", title: "The Satellite style", company: "adidas",
    callouts: [
      [1, "Satellite: EOX's 2016 imagery", [544, -24]],
      [2, "Credits always shown in full", [760, 505]],
      [3, "Shading and sites stay on top", [752, 355], { outline: false }],
    ],
    text: `The Satellite style shows EOX's 2016 imagery under the same shading, sites and panel; Plain and Map are the other styles. <span class="code">Code only</span> If EOX does not respond, the map goes back to Plain with a one-line notice.`,
  },
];

const GOOD_TO_KNOW = [
  `Disaster alerts come from GDACS and are automatic (figure 1).`,
  `A site inside a disaster area is not counted when GDACS does not list its country as affected (figure 5).`,
  `Every number shows its base, for example "Owner known for 551 of 766 sites" (figures 1 and 6).`,
  `A GLEIF match is a candidate until a person confirms it; parent companies show only after that (figures 3 and 8).`,
  `Lists are dated: the site in figure 3 is on Nike's February 2024 list, and Amazon's own lists in figure 7 are dated 2022, 2023, 2024 and 2026.`,
];

// --- checks: every screenshot once, 2–4 callouts each on measured boxes, 3–8 words per callout ---
const order = FIGURES.map((f) => f.shot);
const unused = Object.keys(shots).filter((n) => !order.includes(n));
const unknown = order.filter((n) => !shots[n]);
if (unused.length || unknown.length || new Set(order).size !== order.length) throw new Error(`screenshots: unused ${unused}, unknown ${unknown}`);
for (const f of FIGURES) {
  const s = shots[f.shot];
  if (f.callouts.length < 2 || f.callouts.length > 4) throw new Error(`${f.shot}: ${f.callouts.length} callouts`);
  const used = f.callouts.map(([n]) => n).sort().join();
  if (used !== s.markers.map((m) => m.n).sort().join()) throw new Error(`${f.shot}: callouts ${used}, markers ${s.markers.map((m) => m.n)}`);
  for (const [, text] of f.callouts) {
    const words = text.split(/\s+/).length;
    if (words < 3 || words > 8) throw new Error(`${f.shot}: "${text}" has ${words} words`);
  }
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (v, of) => `${((100 * v) / of).toFixed(3)}%`;
const PAD = 3;                              // boxes sit 3 px outside their element, so they never cover its edge

function figure(f, i) {
  const s = shots[f.shot];
  const box = (n) => s.markers.find((m) => m.n === n);
  const lines = [], boxes = [], pills = [];
  for (const [n, text, [cx, cy], opt = {}] of f.callouts) {
    const m = box(n);
    const x1 = m.x - PAD, y1 = m.y - PAD, x2 = m.x + m.w + PAD, y2 = m.y + m.h + PAD;
    if (opt.outline !== false) boxes.push(`<span class="mk box" style="left:${pct(x1, s.width)};top:${pct(y1, s.height)};width:${pct(x2 - x1, s.width)};height:${pct(y2 - y1, s.height)}"></span>`);
    // a line from the box's nearest edge to the callout's centre (the callout hides its own end of it)
    const px = Math.min(Math.max(cx, x1), x2), py = Math.min(Math.max(cy, y1), y2);
    if (px !== cx || py !== cy) lines.push(`<line x1="${px}" y1="${py}" x2="${cx}" y2="${cy}"/>`);
    pills.push(`<span class="mk pill" style="left:${pct(cx, s.width)};top:${pct(cy, s.height)}"><b>${n}</b>${esc(text)}</span>`);
  }
  const band = f.callouts.some(([, , [, cy]]) => cy < 0);
  return `<section class="fig" id="fig-${i + 1}">
<h2><span class="no">${i + 1}</span>${esc(f.title)}${f.company ? ` <span class="co">${esc(f.company)}</span>` : ""}</h2>
<figure class="shot">
  <div class="frame${band ? " band" : ""}"><div class="img" style="aspect-ratio:${s.width}/${s.height}">
    <img src="assets/${s.file}" width="${s.width}" height="${s.height}" alt="${esc(s.title)}">
    ${boxes.join("")}
    <svg class="mk lines" viewBox="0 0 ${s.width} ${s.height}" preserveAspectRatio="none" aria-hidden="true">${lines.map((l) => l.replace("<line", '<line class="halo"')).join("")}${lines.join("")}</svg>
    ${pills.join("")}
  </div></div>
</figure>
<p>${f.text}</p>
</section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supplier Risk Map Guide</title>
<style>
:root { --ink:#1F2A2E; --muted:#56656A; --line:#DDE3E5; --bg:#F6F7F5; --paper:#FFFFFF; --navy:#1F3A5F; --pin:#C2255C; --code:#5F3DC4; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1180px; margin: 0 auto; padding: 56px 24px 96px; }
h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 14px; }
.intro { margin: 0; color: var(--ink); }
.intro .live { color: #7A4100; background: #FFF4E6; border-radius: 6px; padding: 1px 6px; }
section.fig { margin-top: 56px; }
h2 { font-size: 22px; line-height: 1.25; margin: 0 0 14px; display: flex; align-items: baseline; gap: 10px; }
h2 .no { font-size: 14px; font-weight: 700; color: #fff; background: var(--navy); border-radius: 7px; padding: 1px 8px; }
h2 .co { font-size: 15px; font-weight: 500; color: var(--muted); }
section.fig > p { max-width: 82ch; margin: 14px 4px 0; color: var(--ink); }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #EDF0F1; padding: 1px 5px; border-radius: 4px; }
.code { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--code); background: #F1EDFC; border-radius: 4px; padding: 2px 6px; margin-right: 2px; }
figure.shot { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 12px; box-shadow: 0 1px 2px rgba(31,42,46,0.06); }
.frame.band { padding-top: 34px; }
.img { position: relative; width: 100%; }
.img img { display: block; width: 100%; height: auto; border-radius: 8px; }
.box { position: absolute; border: 2px solid var(--pin); border-radius: 6px; box-shadow: 0 0 0 2px rgba(255,255,255,0.9); pointer-events: none; }
.lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.lines line { stroke: var(--pin); stroke-width: 2; vector-effect: non-scaling-stroke; }
.lines line.halo { stroke: #fff; stroke-width: 5; }
.pill { position: absolute; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; background: var(--pin); color: #fff; font-size: 13px; font-weight: 600; line-height: 1; padding: 4px 11px 4px 4px; border-radius: 999px; box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,0.25); pointer-events: none; z-index: 1; }
.pill b { display: inline-grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: #fff; color: var(--pin); font-size: 11px; font-weight: 800; flex: none; }
section.know { margin-top: 64px; }
section.know ul { margin: 0; padding-left: 22px; max-width: 82ch; }
section.know li { margin-bottom: 6px; }
footer { margin-top: 48px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
#hide-marks { position: absolute; opacity: 0; pointer-events: none; }
.toggle { position: fixed; right: 20px; bottom: 20px; z-index: 10; background: var(--navy); color: #fff; border-radius: 999px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2); user-select: none; }
.toggle::after { content: "Hide callouts"; }
#hide-marks:checked ~ .toggle::after { content: "Show callouts"; }
#hide-marks:checked ~ main .mk { display: none; }
#hide-marks:focus-visible ~ .toggle { outline: 3px solid var(--pin); outline-offset: 2px; }
@media print { .toggle { display: none; } section.fig { break-inside: avoid; } }
</style>
</head>
<body>
<input type="checkbox" id="hide-marks">
<label for="hide-marks" class="toggle" title="Show or hide the callouts on the screenshots"></label>
<main>
<h1>Supplier risk map</h1>
<p class="intro">The Supplier risk map shows where a company's supplier sites are concentrated, which owners hold many, and which are in a current disaster area.<br>
It is for the company's procurement and risk team; the examples use the public supplier lists of adidas, Nike and Amazon.<br>
Captured ${capturedUtc}, with disaster data from ${esc(chipTime)}. <span class="live">Disaster data is live, so areas and counts will differ on another day.</span></p>

${FIGURES.map(figure).join("\n\n")}

<section class="know">
<h2>Good to know</h2>
<ul>
${GOOD_TO_KNOW.map((t) => `<li>${esc(t)}</li>`).join("\n")}
</ul>
</section>

<footer>Captured in headless Chrome ${esc(chrome)} at ${esc(cap.viewport.replace("x", " × "))}, ${cap.scale}×, from app commit ${esc(cap.app_commit)}. Callout boxes were measured on the page at capture time (<code>assets/manifest.json</code>); <code>capture/</code> holds the tool that captures and builds this page.</footer>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
const words = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
console.log(`index.html: ${FIGURES.length} figures, ${FIGURES.reduce((n, f) => n + f.callouts.length, 0)} callouts, ${words} words, ${(html.length / 1024).toFixed(1)} KB`);
