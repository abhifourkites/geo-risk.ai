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
const capturedOn = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;     // the UTC date, e.g. "3 Oct 2026"
const screen = cap.viewport.replace("x", " × ");

// --- the guide: 9 figures; each callout: [marker n, text on the callout, centre of the callout in image px, options] ---
// A centre above the image (y < 0) puts the callout in a strip above it. outline: false draws only the line, which
// ends on the box's edge (for a box that would cross a label or other controls).
const FIGURES = [
  {
    shot: "01-overview", title: "Overview (adidas)",
    callouts: [
      [1, "Pick a company: every number updates", [290, -24], { outline: false }],
      [2, "Time of the last disaster check", [852, 32]],
      [3, "The answer in one sentence", [1284, 200]],
      [4, "Click a card to see its sites", [708, 450]],
    ],
    text: `This is the first screen. At the top you choose a company and see when disaster data was last checked; "Check for new disasters" checks again (not clicked here). One sentence gives the main answer, and three cards break it down: countries, owner companies and current disasters. The tabs switch between the risk map, uploading a supplier list, and reviewing company matches.`,
  },
  {
    shot: "03-map", title: "The map (adidas)",
    callouts: [
      [1, "Map controls: disasters, globe, style, reset", [228, -24]],
      [2, "226 sites here: click to zoom in", [1140, 239]],
      [3, "Red = High: 10%+ of workers", [1122, 150]],
      [4, "Purple = drought: 17 of your sites", [232, 120]],
    ],
    text: `Each dot is a supplier site, and a numbered circle is a group of nearby sites. Countries are coloured by their share of the company's suppliers' workers: red for High, amber for Watch. Purple outlines are current disaster areas. Click a site, a country or a disaster to see its details on the right.`,
  },
  {
    shot: "08-site-panel", title: "A site (PT. Paxar Indonesia, Nike)",
    callouts: [
      [1, "Who owns this site", [720, 120]],
      [2, "Not in a current disaster area", [720, 190]],
      [3, "Parent company, confirmed by a person", [752, 445]],
      [4, "The selected site on the map", [470, 230]],
    ],
    text: `Clicking a site shows who owns it, any warnings, whether it is in a disaster area, which supplier list it comes from, and its parent company. The parent, AVERY DENNISON CORPORATION, comes from GLEIF and shows only because a person confirmed the match.`,
    how: "Nike → Countries table → Indonesia → PT. Paxar Indonesia.",
  },
  {
    shot: "10b-owner-panel", title: "An owner company (POU CHEN, adidas)",
    callouts: [
      [1, "Holds 7.4% of workers: Watch", [1240, 56]],
      [2, "9 sites in 4 countries", [800, 140]],
      [3, "Its sites, highlighted on the map", [1222, 212]],
    ],
    text: `Clicking an owner company shows how much of the company's supply it holds, and where its sites are. POU CHEN owns 9 of adidas's supplier sites in 4 countries, with 7.4% of the workers: enough for Watch. One owner behind many sites is a hidden dependency.`,
    how: "the Owner companies table below the map → POU CHEN.",
  },
  {
    shot: "09d-disaster-other-sites", title: "A disaster: who is affected, and what else depends on them (Apple)",
    callouts: [
      [1, "Your sites inside this disaster", [775, 128]],
      [2, "Who owns those sites", [840, 216]],
      [3, "That owner's other sites elsewhere", [775, 485]],
      [4, "The disaster area on the map", [300, 130]],
    ],
    text: `Clicking a disaster shows three things: which of the company's sites are inside it, who owns those sites, and which other sites those same owners have elsewhere. Here the European drought covers a site owned by HENKEL AG AND KGAA, and the panel shows its 3 other Apple supplier sites, in China and the United States, so you can see what else depends on the same owner.`,
    how: "Apple → the Disasters now card → the drought → scroll down in the panel.",
  },
  {
    shot: "12a-how", title: "How the numbers are worked out (adidas)",
    callouts: [
      [1, "Set the High level (%)", [1000, 236]],
      [2, "Set the Watch level (%)", [1000, 272]],
      [3, "Every number says 'X of Y'", [952, 170]],
    ],
    text: `This section explains every number. A country or owner is High at 10% or more, and Watch at 5% or more; you can change both levels here. Shares use the number of workers at each site, because it is known for most sites (719 of 766).`,
    code: "a changed level updates the country and owner levels, and is not saved; it goes back to 10% and 5% when the page is reopened.",
  },
  {
    shot: "14b-upload-amazon", title: "Adding a supplier list (Amazon)",
    callouts: [
      [1, "File read: 3798 rows, 980 lists", [1180, 229]],
      [2, "Amazon found and filled in", [1180, 276]],
      [3, "Its 2026 list is ticked", [900, 579]],
    ],
    text: `To add a company, choose its supplier list downloaded from Open Supply Hub. The app reads the file, finds the company (here Amazon, on every row), and ticks its newest list. Personal contact details in the file are dropped. Nothing is added until you check the name and click "Load this company" (not clicked here).`,
  },
  {
    shot: "15b-network-paxar", title: "Confirming a company match (PT. Paxar Indonesia, Nike)",
    callouts: [
      [1, "Confirm or reject a match", [900, 300]],
      [2, "Confirmed by a person", [1240, 140]],
      [3, "Solid line: a confirmed match", [1000, 440]],
      [4, "Parent company: AVERY DENNISON CORPORATION", [972, 505]],
    ],
    text: `The app suggests matches between supplier sites or owners and companies in GLEIF. A suggestion stays a dashed line until a person confirms it. Once confirmed, the line turns solid and the parent company appears: here, AVERY DENNISON CORPORATION. It then also shows in the site panel (figure 3).`,
  },
  {
    shot: "06-style-satellite", title: "Map styles (adidas)",
    callouts: [
      [1, "Satellite view: 2016 images", [544, -24]],
      [2, "Image credits, always shown", [760, 505]],
      [3, "Shading and sites stay on top", [752, 355], { outline: false }],
    ],
    text: `There are three map styles: Plain (the default), Map (with place names) and Satellite. Satellite shows satellite images from 2016; the coloured countries, sites and panel stay the same.`,
    code: "if the satellite service does not respond, the map goes back to Plain and shows a short notice.",
  },
];

const GOOD_TO_KNOW = [
  `Disaster alerts are automatic and not checked by people. Confirm before acting.`,
  `Every number shows what it is out of, for example "Owner known for 551 of 766 sites".`,
  `A company match is only a suggestion until a person confirms it (figures 3 and 8).`,
  `Supplier lists have dates: Nike's is from February 2024; Amazon's newest is from 2026.`,
];

// the guide's terms, in a small box under the intro
const WORDS = [
  ["Open Supply Hub", "a public database of the supplier factories that brands publish."],
  ["GDACS", "a public service that sends automatic alerts about natural disasters."],
  ["GLEIF", "the global register of company identities, which also records parent companies."],
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
<h2><span class="no">${i + 1}</span>${esc(f.title)}</h2>
<figure class="shot">
  <div class="frame${band ? " band" : ""}"><div class="img" style="aspect-ratio:${s.width}/${s.height}">
    <img src="assets/${s.file}" width="${s.width}" height="${s.height}" alt="${esc(s.title)}">
    ${boxes.join("")}
    <svg class="mk lines" viewBox="0 0 ${s.width} ${s.height}" preserveAspectRatio="none" aria-hidden="true">${lines.map((l) => l.replace("<line", '<line class="halo"')).join("")}${lines.join("")}</svg>
    ${pills.join("")}
  </div></div>
</figure>
<p>${esc(f.text)}</p>${f.code ? `
<p><span class="code">Code only</span> ${esc(f.code)}</p>` : ""}${f.how ? `
<p class="how">How to get here: ${esc(f.how)}</p>` : ""}
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
.words { margin-top: 18px; max-width: 82ch; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px 18px; font-size: 15px; }
.words h3 { margin: 0 0 6px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.words ul { margin: 0; padding-left: 20px; }
.words li { margin-bottom: 2px; }
section.fig > p { max-width: 82ch; margin: 14px 4px 0; color: var(--ink); }
section.fig > p.how { margin-top: 6px; font-size: 15px; color: var(--muted); }
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
<p class="intro"><b>What it is:</b> a map that shows where a company's supplier sites are, which owner groups hold many of them, and which sites are inside a current natural disaster.<br>
<b>Who it's for:</b> a company's procurement and supply-chain risk team.<br>
The examples use public supplier lists from adidas, Nike, Apple and Amazon. Screenshots taken on ${capturedOn} (UTC). <span class="live">Disaster data is live, so on another day the disasters and counts will differ.</span></p>
<aside class="words" aria-label="Words used">
<h3>Words used</h3>
<ul>
${WORDS.map(([w, t]) => `<li><b>${esc(w)}:</b> ${esc(t)}</li>`).join("\n")}
<li><span class="code">Code only</span> the sentence comes from the app's code, not from a screenshot.</li>
</ul>
</aside>

${FIGURES.map(figure).join("\n\n")}

<section class="know">
<h2>Good to know</h2>
<ul>
${GOOD_TO_KNOW.map((t) => `<li>${esc(t)}</li>`).join("\n")}
</ul>
</section>

<footer>Screenshots taken in Chrome at ${esc(screen)} on ${capturedOn}. The tool that made them is in docs/walkthrough/capture/.</footer>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
const words = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
console.log(`index.html: ${FIGURES.length} figures, ${FIGURES.reduce((n, f) => n + f.callouts.length, 0)} callouts, ${words} words, ${(html.length / 1024).toFixed(1)} KB`);
