// Builds ../index.html from ../assets/manifest.json (written by capture.mjs) and the guide's text below.
// Every marker is drawn from its box in the manifest (measured on the page at capture time); nothing is placed by
// hand. Text describes only what the screenshots show or what the app's source code does ("Code only" notes).
//
// Usage: node build.mjs
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/manifest.json"), "utf8"));
const shots = Object.fromEntries(manifest.shots.map((s) => [s.name, s]));
const cap = manifest.captured;

// --- capture facts, from the manifest ---
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = new Date(cap.at_utc);
const pad = (n) => String(n).padStart(2, "0");
const capturedUtc = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
const localMatch = cap.at_local.match(/ (\d\d:\d\d):\d\d GMT[+-]\d{4} \(([^)]+)\)/);
const capturedLocal = localMatch ? `${localMatch[1]} ${localMatch[2]}` : "";
const chip = cap.disaster_data_chip;                       // e.g. "Disaster data: 3 Oct 2026, 12:38 UTC"
const chrome = cap.chrome.replace(/^HeadlessChrome\/|^Chrome\//, "").split(".")[0];

// --- the guide's text ---
// A section: { id, title, intro, steps: [{ heading?, text?, shot?, shown, marks: { n: [short, text] }, do, next, code: [] }], after }
// [[name]] in any text becomes a link to that screenshot's figure.
const SECTIONS = [
  {
    id: "getting-around", title: "Getting around",
    intro: `<p>Every page has the same bar at the top: the company you are looking at, when disaster data was last read, and the three pages.</p>`,
    steps: [
      {
        shot: "01-header",
        shown: `The top bar on the Risk map page, with adidas chosen.`,
        marks: {
          1: ["Company", `Chooses whose supplier lists you see. Every number, map, panel and table below then belongs to that company only. Changing it on Risk map or Upload a supplier list opens Risk map; on Company network you stay on that page.`],
          2: ["Disaster data", `When the app last read GDACS's list of current disasters, in UTC. Here: "${chip}".`],
          3: ["Check for new disasters", `Reads GDACS again now, then reloads the page's numbers. While it runs, the button reads "Checking…". It was not clicked for this guide.`],
          4: ["Pages", `The three pages: Risk map, Upload a supplier list and Company network.`],
        },
        do: `Pick a company in the Company list, or click a page.`,
        next: `The page shows that company. While its numbers load, "Loading <i>company</i>…" is shown ([[13-loading]]).`,
        code: [
          `The chip reads "Checking for current disasters…" while the first GDACS check after a start is still running, and the page asks again every 5 seconds. It reads "Disaster data unavailable", outlined in red, when the disaster data could not be read. <span class="src">App.tsx</span>`,
          `While a GLEIF candidate search runs for the chosen company, a chip "Finding GLEIF candidates: N of M names" appears next to the company. Clicking it opens Company network. <span class="src">App.tsx</span>`,
        ],
      },
      {
        shot: "13-loading",
        shown: `Just after choosing Nike: the chip reads "Loading…", and "Loading Nike…" takes the place of the page until Nike's numbers arrive. For this screenshot only, the capture browser's network was slowed by 4 seconds, so that the message stayed on screen long enough to be captured.`,
        marks: {
          1: ["Company", `Now Nike.`],
          2: ["Loading Nike…", `The previous company's numbers and panel are cleared at once, so adidas's numbers never show under Nike's name.`],
        },
        do: `Wait.`,
        next: `Nike's summary, cards, map and tables appear, and the map fits Nike's sites.`,
        code: [],
      },
    ],
  },
  {
    id: "risk-map", title: "Risk map, piece by piece",
    intro: `<p>The Risk map page answers three questions for the chosen company: where its suppliers' sites are concentrated, which owner companies hold many of them, and which sites are inside a current disaster area. From top to bottom: the summary and three cards, the map with its details panel, two tables (see <a href="#where-exposed">Where is my company exposed?</a>), and two sections that explain the numbers. The screenshots in this section use adidas.</p>`,
    steps: [
      {
        shot: "02-summary",
        shown: `The top of the Risk map page for adidas.`,
        marks: {
          1: ["Company and sites", `"adidas · 766 sites on your current lists".`],
          2: ["Summary sentence", `One sentence with the answer: "3 countries at High (Vietnam, Indonesia, China) and 3 at Watch, by share of your suppliers' workers; 2 owner companies at Watch; 17 of your sites are inside current disaster areas (alert: Orange)."`],
          3: ["Countries", `"3 countries hold 10% or more": Vietnam 31.5%, Indonesia 19.5% and China 12.8%, each High. Below: "3 more hold 5% or more: Pakistan 8.4%, Cambodia 8.2%, India 5.0%". The last line gives the basis: "Share of your suppliers' workers".`],
          4: ["Owner companies", `"2 owners hold 5% or more": POU CHEN 7.4% and THE LOOK MACAO COMMERCIAL OFFSHORE 5.9%, both Watch. The base: "Owner known for 551 of 766 sites".`],
          5: ["Disasters now", `"17 of your sites are inside 1 current disaster area": the drought in Austria, Bosnia and Herzegovina, Belgium and 26 more countries, 17 sites, Alert: Orange. The source: "Disaster data: GDACS, automatic alerts".`],
        },
        do: `Click a card.`,
        next: `The card is outlined and the details panel lists what it counts: the countries at High or Watch, the owners at High or Watch (or the largest owner when none is), or each disaster with your sites inside. The map highlights their sites and moves to them. Clicking the same card again closes its panel.`,
        code: [`The panel each card opens ("Where you are most exposed", "Owners holding the biggest shares", "Your sites inside a current disaster area") is not captured in this guide. <span class="src">Panel.tsx, App.tsx</span>`],
      },
      {
        shot: "03-map",
        shown: `The map in its default state: Plain style, Flat map, all of adidas's sites in view, and the empty details panel: "Click a site, a country or a disaster area to see details."`,
        marks: {
          1: ["Show all", `Show all current disasters. Off (as here), the map draws only the disaster areas that hold at least one of your sites, plus a disaster you selected. On: see [[07-show-all]].`],
          2: ["Projection", `Flat map or Globe view ([[04-globe]]). Switching moves the map back to your sites.`],
          3: ["Map style", `Plain, Map or Satellite (see <a href="#map-styles">Map styles</a>).`],
          4: ["Reset view", `Back to all your sites, without tilt or rotation.`],
          5: ["Zoom, compass", `Zoom in and out. The compass shows the map's rotation and tilt; clicking it turns the map back to north and flat.`],
          6: ["Group of sites", `Nearby sites are grouped in a circle with their count: here 226. Clicking a group zooms in until it splits.`],
          7: ["High country", `Vietnam, filled red: High, 10% or more. Countries at Watch (5% to under 10%) are filled amber: India, Pakistan and Cambodia here. Clicking a country opens its panel ([[10a-country-panel]]).`],
          8: ["Disaster area", `The drought DR1018332's affected area, outlined in purple. Clicking it opens the disaster panel ([[09a-disaster-panel]]).`],
          9: ["Legend", `High: 10% or more; Watch: 5% to under 10%; Disaster area; Your site; Group of sites (count); Selected site. The percentages follow the High at and Watch at fields ([[12a-how]]).`],
          10: ["Details panel", `Shows whatever you click: a site, a country, an owner or a disaster.`],
        },
        do: `Hover over the map, or click a site, a group, a country or a disaster area.`,
        next: `A click opens the details panel and moves the map to the selection; a click on a group zooms in.`,
        code: [
          `Hovering shows a label: a site's name and country; for a group, "N sites" and "Click to zoom in"; for a country, its name and its level and share (or "N of your sites", or "None of your sites"); for a disaster area, its name and "Disaster area (alert: …)". <span class="src">MapView.tsx</span>`,
          `Below the map, outside this screenshot, a line reads "Disaster data: GDACS, automatic alerts. Confirm before acting." When a High or Watch country is too small to draw at the map's scale, another line names it: "Too small to draw at this map scale: … Their sites still show on the map." <span class="src">MapView.tsx</span>`,
          `The credits in the bottom-right corner ("Natural Earth | MapLibre" on Plain) are always shown in full. <span class="src">MapView.tsx</span>`,
        ],
      },
      {
        shot: "04-globe",
        shown: `The same map as a globe, centred on adidas's sites.`,
        marks: {
          1: ["Globe view", `Selected. Flat map goes back to the flat projection.`],
          2: ["Reset view", `On the globe: centres it on your sites again.`],
        },
        do: `Drag to turn the globe; use Flat map to go back.`,
        next: `Sites, groups, shading and disaster areas behave as on the flat map.`,
        code: [],
      },
      {
        shot: "07-show-all",
        shown: `Show all current disasters, turned on: every current GDACS affected area is drawn, not only those that hold your sites. Areas narrower than 3 degrees also get a ring, so they can be seen when zoomed out; the many small circles are these rings.`,
        marks: {
          1: ["Show all", `On.`],
          2: ["None of your sites", `Tropical Cyclone RACHEL-26 (TC1001329, Green alert). It is drawn only because Show all is on: all 17 of adidas's sites inside a disaster area are in the drought DR1018332.`],
        },
        do: `Turn it off to see only the areas that hold your sites.`,
        next: `Only the map changes. The summary sentence, the cards and the tables count the same sites with the switch on or off.`,
        code: [`The rings are drawn only when zoomed out (below zoom 4.5). <span class="src">MapView.tsx</span>`],
      },
      {
        shot: "12a-how",
        shown: `"How these numbers are worked out", opened. It explains the counted sites (766 for adidas), the share basis (workers, known for 719 of 766 sites), coverage, the levels and how owners are counted ("56 of 156 owners with 2 or more sites have all of them in one country").`,
        marks: {
          1: ["High at (%)", `The share at which a country or owner is High: 10.`],
          2: ["Watch at (%)", `The share at which it is at Watch: 5. Next to them: "Now: High 10% or more, Watch 5% or more."`],
          3: ["Coverage", `"Owner known for 551 of 766 sites. Location known for 766 of 766 sites."`],
        },
        do: `Change High at or Watch at.`,
        next: `The app works out the numbers again with the new thresholds: the sentence, the cards, the shading, the legend and the tables follow.`,
        code: [`The thresholds are not saved: they start at 10 and 5 each time the page is opened. <span class="src">App.tsx</span>`],
      },
      {
        shot: "12b-source",
        shown: `"Source and limits of the data", opened.`,
        marks: {
          1: ["Disaster data", `"GDACS (Global Disaster Awareness and Coordination System). Alerts are automatic, not reviewed by people. Confirm before making decisions."`],
          2: ["Your lists", `The lists counted for adidas; "each name carries the list's date": Primary Jan 2026, Licensee Jan 2026 and Wet Process Suppliers Apr 2026.`],
        },
        do: `Read before acting on a number.`,
        next: `Nothing changes; this section only explains.`,
        code: [`When GDACS's list of current disasters repeats entries across its pages, a line here says that some disasters may be missing from the map. There was no such line at capture time. <span class="src">App.tsx</span>`],
      },
    ],
  },
  {
    id: "where-exposed", title: "Workflow: Where is my company exposed?",
    intro: `<p>Start from the summary sentence and the cards ([[02-summary]]), then use the tables and panels to see which countries, owners and sites make up each number. Steps 1 to 4 use adidas; step 5 uses Nike.</p>`,
    steps: [
      {
        heading: "Open the Countries table", shot: "11a-countries-table",
        shown: `The tables below the map, on the Countries tab: "Share of your suppliers' workers, largest first. Click a row to see it on the map."`,
        marks: {
          1: ["Tabs", `Countries or Owner companies.`],
          2: ["Search", `Filters the rows as you type.`],
          3: ["Share", `Sorted by Share, largest first. Click a column header to sort by that column.`],
          4: ["Vietnam", `31.5%, High, 157 sites, workers known for 149 of 157.`],
          5: ["Rows and pages", `10 rows per page (25, 50 or 100 can be chosen): "1–10 of 46".`],
        },
        do: `Click the Vietnam row.`,
        next: `The country panel opens ([[10a-country-panel]]) and the map moves to Vietnam's sites.`,
        code: [],
      },
      {
        heading: "Read the country panel", shot: "10a-country-panel",
        shown: `The country panel for Vietnam.`,
        marks: {
          1: ["Share and level", `"31.5% of your suppliers' workers", High. Below: "157 sites; workers known for 149 of 157. These sites are highlighted on the map."`],
          2: ["Sites", `Vietnam's sites, A to Z.`],
          3: ["On the map", `Vietnam is outlined and its sites are highlighted; other sites are faded.`],
        },
        do: `Click a site name.`,
        next: `The site panel opens (like [[08-site-panel]]) and the map flies to the site, tilted.`,
        code: [],
      },
      {
        heading: "Switch to Owner companies", shot: "11b-owners-table",
        shown: `The Owner companies tab: "A site with 2 or more owners counts in full under each." 509 owners, 10 per page.`,
        marks: {
          1: ["Owner companies", `The tab.`],
          2: ["POU CHEN", `7.4%, Watch, 9 sites, 4 countries.`],
          3: ["Countries", `An owner in one country shows that country (STYLE TEXTILE: Pakistan); otherwise the number of countries.`],
        },
        do: `Click the POU CHEN row.`,
        next: `The owner panel opens ([[10b-owner-panel]]) and the map moves to its sites.`,
        code: [],
      },
      {
        heading: "Read the owner panel", shot: "10b-owner-panel",
        shown: `The owner panel for POU CHEN. Its 9 sites are highlighted on the map; other sites are faded.`,
        marks: {
          1: ["Share and level", `"7.4% of your suppliers' workers", Watch. Below: "9 sites in 4 countries: China, Indonesia, Myanmar (Burma), Vietnam. Not all in one country."`],
          2: ["Its sites", `Each site with its country.`],
        },
        do: `Click a site.`,
        next: `Its site panel opens and the map flies to it.`,
        code: [],
      },
      {
        heading: "Read a site panel (Nike)", shot: "08-site-panel",
        shown: `The site panel for Nike's PT. Paxar Indonesia (Open Supply Hub ID ID2021182JC36SX), opened from Nike's Countries table (Indonesia), then the site. The panel also shows "Warnings: None." and "about 334 workers".`,
        marks: {
          1: ["Owner companies", `AVERY DENNISON. Clicking an owner opens its owner panel.`],
          2: ["Disaster area", `"Not inside a current disaster area."`],
          3: ["On your lists", `The list the site is on: "Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)".`],
          4: ["Parent company", `"Direct parent: AVERY DENNISON CORPORATION" and "Top parent: AVERY DENNISON CORPORATION", from GLEIF. They show because a person confirmed this site's GLEIF match ([[15b-network-paxar]]).`],
          5: ["The site", `The selected site, with a ring. The map flew to it.`],
        },
        do: `Click the owner to see its other sites, or another site on the map.`,
        next: `The panel shows the owner or the other site.`,
        code: [
          `A site inside a disaster area lists that disaster with its alert and "High for your sites" or "Watch for your sites"; clicking it opens the disaster panel. A site inside an area whose country GDACS does not list as affected shows "Not counted: inside the area, but GDACS does not list … as affected." <span class="src">Panel.tsx</span>`,
          `Without a confirmed GLEIF match, Parent company reads "No confirmed parent company." <span class="src">Panel.tsx</span>`,
        ],
      },
    ],
  },
  {
    id: "disaster-hits", title: "Workflow: A disaster hits",
    intro: `<p>This example uses Amazon.com, Inc. and the drought DR1018332, current at capture time. Disaster data is live: on another day the areas, the sites inside them and the counts will differ.</p>
      <p><b>Step 1.</b> Click the Disasters now card: its panel lists each disaster with your sites inside. Click the drought there, or click its purple area on the map.</p>`,
    steps: [
      {
        heading: "Read the disaster panel", shot: "09a-disaster-panel",
        shown: `The disaster panel for the drought, with the map fitted to its area and the sites inside.`,
        marks: {
          1: ["Alert and level", `The disaster's name, with the countries GDACS lists; "Alert: Orange", "so your sites inside are at High"; and "GDACS alerts are automatic, not reviewed by people. Confirm before acting."`],
          2: ["Your sites inside (33)", `Each site with its country and owner, for example "PROPET AUSTRIA · Austria · Owner: PRO PET".`],
          3: ["The area", `The drought's affected area, outlined more thickly while it is selected. The sites inside are highlighted.`],
        },
        do: `Scroll the panel.`,
        next: `The owners of those sites and the owners' other sites follow ([[09b-disaster-owners]]).`,
        code: [],
      },
      {
        heading: "See the owners", shot: "09b-disaster-owners",
        shown: `The same panel, scrolled down.`,
        marks: {
          1: ["Their owners", `The owners of the sites inside: PRO PET. Clicking an owner opens its owner panel.`],
          2: ["Other sites", `"Those owners' other sites": the same owners' other sites on your lists. "None." here: PRO PET has no other site on Amazon's lists.`],
        },
        do: `Scroll further.`,
        next: `The sites that are inside the area but not counted follow ([[09c-disaster-unlisted]]).`,
        code: [],
      },
      {
        heading: "Check the sites that are not counted", shot: "09c-disaster-unlisted",
        shown: `The end of the panel.`,
        marks: {
          1: ["Not counted", `"Inside the area, but GDACS does not list United Kingdom as affected (47)", with "Not counted: GDACS lists 29 countries as affected by this event." Then the 47 sites in the United Kingdom. They are listed, but they are not among the 33 and do not change the level.`],
        },
        do: `Click a site to open its panel.`,
        next: `Its site panel says "Not counted: inside the area, but GDACS does not list United Kingdom as affected."`,
        code: [],
      },
      {
        heading: "When the owners have other sites (Apple)", shot: "09d-disaster-other-sites",
        shown: `The same drought for Apple, whose owners inside the area also have sites elsewhere.`,
        marks: {
          1: ["Other sites", `"HENKEL AG AND KGAA: 3 other sites" (China, and two in the United States) and "INTEL: 8 other sites" (China, Israel, Malaysia, the United States, …).`],
        },
        do: `Click one of these sites.`,
        next: `Its site panel opens and the map flies to it. While the disaster is selected, these other sites are highlighted on the map with the sites inside.`,
        code: [],
      },
    ],
  },
  {
    id: "add-list", title: "Workflow: Add a new supplier list",
    intro: `<p>A company's list is an Open Supply Hub download (CSV). Nothing is loaded until you click "Load this company"; it was not clicked for this guide. The two files used here are in the repository: <code>data/demo/amazon.csv</code> and <code>data/demo/facilities.csv</code>.</p>`,
    steps: [
      {
        heading: "Open the upload page", shot: "14a-upload-empty",
        shown: `Upload a supplier list, before a file is chosen.`,
        marks: {
          1: ["The three steps", `"Choose an Open Supply Hub download (CSV). Personal contact columns (claim_*) are dropped." The company is filled in, and its lists with the latest year in their name are ticked and marked current. "Only sites on a current list that are not closed are loaded. A new upload replaces only this company's data."`],
          2: ["Choose a file", `Opens the file picker. "No file chosen" until then.`],
        },
        do: `Click Choose a file and pick a CSV.`,
        next: `The file is sent to the app, which reads it and keeps it until you load it. The lists in it appear ([[14b-upload-amazon]]).`,
        code: [],
      },
      {
        heading: "A file for one company", shot: "14b-upload-amazon",
        shown: `<code>amazon.csv</code> chosen, not loaded.`,
        marks: {
          1: ["Rows and lists", `"3798 rows in the file, naming 980 lists."`],
          2: ["Company found", `"Amazon.com, Inc. is on every row of the file, so it is filled in. Check its lists below."`],
          3: ["Ticked and current", `"Showing 850 of 980 lists; Amazon.com, Inc.'s lists first. Ticked: 1, current: 1." Above it: Search lists, and "Show all lists (130 hidden: anonymous types and "(Claimed)" entries)".`],
          4: ["The 2026 list", `"Amazon.com, Inc. (Amazon Facility List 2026)", 1732 sites: ticked under Company's list and under Current. The 2022, 2023 and 2024 lists are not ticked.`],
        },
        do: `Check the ticks: Company's list marks the company's own lists; Current marks which of those count. Current can be ticked only on a ticked list.`,
        next: `Scroll down to the name and the load button ([[14c-upload-amazon-name]]).`,
        code: [],
      },
      {
        heading: "Check the name", shot: "14c-upload-amazon-name",
        shown: `The bottom of the same page.`,
        marks: {
          1: ["Company name", `Filled in: "Amazon.com, Inc." It can be changed.`],
          2: ["Load this company", `Loads the company (not clicked for this guide). It works only with a name and at least one ticked list marked Current.`],
        },
        do: `Click Load this company.`,
        next: `See the notes below: this step was not run.`,
        code: [
          `The app loads the sites on the current lists that are not closed, replacing only this company's data. The upload page reports "Loaded <i>name</i>: N sites on current lists (as of …).", and the app then opens Risk map with the company chosen. <span class="src">Upload.tsx, App.tsx, main.py</span>`,
          `For a company other than adidas and Nike, a GLEIF candidate search then starts in the background (the chip in the top bar, and [[15d-network-samsung]]). <span class="src">main.py, gleif_api.py</span>`,
        ],
      },
      {
        heading: "A file with several companies", shot: "14d-upload-facilities",
        shown: `<code>facilities.csv</code> chosen, not loaded. No company is on every row, so none is filled in.`,
        marks: {
          1: ["Rows and lists", `"1536 rows in the file, naming 881 lists."`],
          2: ["Suggestions", `"No company is on every row of the file. Which company is it for? The companies on the most rows:" Nike 56.5%, Wikirate International e.V. 51.8%, adidas 49.9%, Social & Labor Convergence Program (SLCP) 45.0%, Partnership for Sustainable Textiles (PST) 41.9%.`],
          3: ["Search, Show all", `Search lists, and "Show all lists (118 hidden: anonymous types and "(Claimed)" entries)". Below: "Showing 763 of 881 lists. Ticked: 0, current: 0."`],
        },
        do: `Click the company the file is for.`,
        next: `Its lists with the latest year in their name are ticked and marked current, its lists move to the top, and its name is filled in. You can change all three before loading.`,
        code: [],
      },
    ],
  },
  {
    id: "review-match", title: "Workflow: Review a company match",
    intro: `<p>The Company network page shows how Open Supply Hub sites and owner names are matched to GLEIF companies, for the company chosen in the top bar. "A match is only a candidate until a person confirms it here; a confirmed match shows its GLEIF parent companies, here and in the map's site panel. Verdicts are saved and kept after a restart." No verdict was given for this guide.</p>`,
    steps: [
      {
        heading: "Look at the candidates", shot: "15a-network-adidas",
        shown: `Company network for adidas: the candidates on the left, 20 per page ("Showing 1–20 of 221 candidates."), and the selected candidate's graph on the right.`,
        marks: {
          1: ["Counts", `"221 candidates for adidas from the GLEIF file: 25 likely, 101 possible, 95 unlikely. Confirmed 4, rejected 0, not decided 217." Next to it, Download verdicts (CSV) downloads this company's verdicts.`],
          2: ["Review level", `Shows all levels, or only 1 likely, 2 possible or 3 unlikely (each with its count).`],
          3: ["Search", `Filters by your names, the GLEIF names or the LEI.`],
          4: ["A candidate", `MOCHIKO SHOES · owner · 3 sites · India ↔ MOCHIKO SHOES (India). Below: its LEI, how the name matched ("exact, on the GLEIF legal name"), its level ("2 possible (file: 1 likely)") and GLEIF's status ("not active; registration retired"). Its chip: Not decided.`],
          5: ["Verdict buttons", `Confirm: the same company. Reject: not the same company. Undo: takes back a verdict given on this page. None was clicked.`],
          6: ["Dashed line", `Between the Open Supply Hub owner and the GLEIF company: a candidate, not confirmed.`],
        },
        do: `Click a candidate to see its graph; filter or search to find one.`,
        next: `The graph shows your company, its Open Supply Hub sites, the owner, and the GLEIF company. The text under it explains the lines.`,
        code: [
          `Confirm is greyed out once a candidate is confirmed, Reject once it is rejected, and Undo unless the verdict was given on this page. <span class="src">Network.tsx</span>`,
          `A site with yes and no from two candidates is marked "conflicting verdicts – needs review", is not confirmed and shows no parent; the row names the other candidate. <span class="src">Network.tsx</span>`,
        ],
      },
      {
        heading: "A confirmed match, with its parent (Nike)", shot: "15b-network-paxar",
        shown: `Nike's candidates, searched for "Paxar": 2 candidates. PT. Paxar Indonesia is selected.`,
        marks: {
          1: ["Confirmed", `This candidate's verdict.`],
          2: ["Solid line", `From the site PT. Paxar Indonesia to the GLEIF company PT PAXAR INDONESIA (LEI 549300YDGYNJ5OSNWF92): confirmed.`],
          3: ["Parent", `"GLEIF · direct and top parent": AVERY DENNISON CORPORATION (LEI 549300PW7VPFCYKLIV37). The same parent shows in the map's site panel ([[08-site-panel]]).`],
        },
        do: `Nothing more is needed for a confirmed match.`,
        next: `Undo is greyed out: this verdict comes from the saved verdict files, not from this page. Reject would remove the line and the parent.`,
        code: [],
      },
      {
        heading: "One verdict for every list (Apple)", shot: "15c-network-henkel",
        shown: `Apple's candidates, searched for "HENKEL". The counts read "203 candidates for Apple from GLEIF's API: 2 likely, 47 possible, 154 unlikely. Confirmed 2, rejected 0, not decided 201." Under them: "Candidates found by a GLEIF API search of 41 owner names (37 requests sent; the rest from the cache)."`,
        marks: {
          1: ["Shared verdict", `"One verdict for this GLEIF company; it also applies to other lists with the same owner name." A verdict here also counts for another company whose list has the same owner name matched to the same LEI.`],
          2: ["Your company", `The graph shows only Apple and Apple's 4 HENKEL sites. Other companies with the same owner are not named.`],
        },
        do: `Give a verdict knowing it is shared.`,
        next: `The verdict applies on every company's page where the same owner name and LEI appear.`,
        code: [],
      },
      {
        heading: "No candidates yet (Samsung)", shot: "15d-network-samsung",
        shown: `Company network for Samsung, before any GLEIF search.`,
        marks: {
          1: ["No candidates yet", `"No GLEIF candidates for this company yet. The search asks GLEIF's API about each of its 102 owner names, at most one request a second. Every candidate then waits for a person's verdict."`],
          2: ["Find GLEIF candidates", `"Find GLEIF candidates, about 2 minutes": starts the search. Not clicked for this guide.`],
        },
        do: `Click Find GLEIF candidates.`,
        next: `See the notes below: this step was not run.`,
        code: [
          `While the search runs: "Finding GLEIF candidates in the background: N of M owner names searched." with a progress bar and "You can keep using the app."; the list fills in as it goes. If it stops: "The GLEIF search stopped after …" with Try again. If GLEIF finds nothing: "GLEIF returned no candidates for this company's … owner names." <span class="src">Network.tsx</span>`,
        ],
      },
    ],
  },
  {
    id: "map-styles", title: "Map styles",
    intro: `<p>Plain ([[03-map]]) is the default: the app's own map, which needs no outside service. Map and Satellite add a base map from a free outside service under the same sites, shading and disaster areas. Both screenshots show adidas's Vietnam panel.</p>`,
    steps: [
      {
        shot: "05-style-map",
        shown: `The Map style, zoomed to Vietnam: borders, seas and place names (here in English and in local scripts).`,
        marks: {
          1: ["Map", `Selected.`],
          2: ["Credits", `"Natural Earth | MapLibre | OpenFreeMap © OpenMapTiles © OpenStreetMap contributors", always shown in full.`],
        },
        do: `Switch styles at any time.`,
        next: `Only the base map changes; the selection and the panel stay.`,
        code: [`On Map and Satellite only the High and Watch countries are filled, and on Map the base map's own borders replace the app's white ones. <span class="src">basemap.ts, MapView.tsx</span>`],
      },
      {
        shot: "06-style-satellite",
        shown: `The Satellite style, with its tiles loaded.`,
        marks: {
          1: ["Satellite", `Selected.`],
          2: ["Credits", `"EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017) CC BY 4.0", always shown in full.`],
        },
        do: `Click Plain to go back to the app's own map.`,
        next: `The base map is removed.`,
        code: [],
      },
    ],
    after: `<div class="code"><span class="tag">Code only</span> No screenshot. <span class="src">MapView.tsx, basemap.ts</span>
      <ul>
        <li>A switch replaces only the base map below the app's layers: sites, shading and disaster areas stay on the map while the new tiles fill in.</li>
        <li>The first switch to Map fetches its style from OpenFreeMap; "Loading map style…" shows over the map meanwhile. Later switches use the copy already fetched.</li>
        <li>If the service does not respond, the map goes back to Plain and a line under the map says so: "Map: OpenFreeMap did not respond, so the plain map is shown." or "Satellite: EOX did not respond, so the plain map is shown."</li>
      </ul></div>`,
  },
];

// Only limits that a screenshot shows.
const GOOD_TO_KNOW = [
  [`Disaster alerts are automatic.`, `"GDACS alerts are automatic, not reviewed by people. Confirm before acting." [[09a-disaster-panel]]; Source and limits of the data says the same ([[12b-source]]).`],
  [`Disaster data is live.`, `The top bar says when it was last read ([[01-header]]). This guide's screenshots show the disasters current at ${capturedUtc}.`],
  [`Some sites inside an area are not counted.`, `A site inside an area whose country GDACS does not list as affected is listed, but not counted: "Inside the area, but GDACS does not list United Kingdom as affected (47)". [[09c-disaster-unlisted]]`],
  [`Every number shows its base.`, `For example "Owner known for 551 of 766 sites" and "workers known for 149 of 157". [[02-summary]], [[10a-country-panel]], [[12a-how]]`],
  [`Shares use workers only when they are known for at least 90% of sites.`, `[[12a-how]]`],
  [`A site with 2 or more owners counts in full under each owner.`, `[[11b-owners-table]], [[12a-how]]`],
  [`Lists are dated.`, `"Each name carries the list's date", for example Jan 2026 and Apr 2026 for adidas, and February 2024 for Nike's PT. Paxar Indonesia. [[12b-source]], [[08-site-panel]]`],
  [`Only sites on a current list that are not closed are counted and loaded.`, `[[12a-how]], [[14a-upload-empty]]`],
  [`Some lists in an upload are hidden by default.`, `"Show all lists (130 hidden: anonymous types and "(Claimed)" entries)". [[14b-upload-amazon]]`],
  [`A GLEIF match is only a candidate until a person confirms it.`, `A parent company shows only after that. [[15a-network-adidas]], [[08-site-panel]]`],
  [`The GLEIF search takes minutes.`, `"At most one request a second": about 2 minutes for Samsung's 102 owner names. [[15d-network-samsung]]`],
  [`Satellite imagery is not current.`, `Its credit names "Copernicus Sentinel data 2016 & 2017". [[06-style-satellite]]`],
];

// --- figure numbers, in reading order; every screenshot exactly once ---
const order = SECTIONS.flatMap((s) => s.steps.map((st) => st.shot));
const unknown = order.filter((n) => !shots[n]);
const missing = Object.keys(shots).filter((n) => !order.includes(n));
const twice = order.filter((n, i) => order.indexOf(n) !== i);
if (unknown.length || missing.length || twice.length) throw new Error(`screenshots: unknown ${unknown}, unused ${missing}, used twice ${twice}`);
const figNo = Object.fromEntries(order.map((n, i) => [n, i + 1]));
const refs = (html) => html.replace(/\[\[([\w-]+)\]\]/g, (_, n) => {
  if (!figNo[n]) throw new Error(`reference to unknown screenshot ${n}`);
  return `<a href="#fig-${n}">Figure ${figNo[n]}</a>`;
});
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- one figure: the screenshot, a box and a numbered callout per marker ---
// Where each callout sits relative to its marker's box (the box itself always comes from the manifest):
// above (default), below, inside (top edge), bottom (inside, bottom edge), left or right (vertically centred);
// align "start" | "end", or at: a fraction of the box's width; label: false shows the number only; nudge: [dx, dy] px.
const PLACE = {
  "01-header": { 4: { pos: "inside", align: "end" } },
  "02-summary": { 2: { pos: "right" }, 3: { pos: "inside", align: "end" }, 4: { pos: "inside", align: "end" }, 5: { pos: "inside", align: "end" } },
  "03-map": { 5: { pos: "left" }, 7: { pos: "right" }, 8: { pos: "right" }, 10: { pos: "bottom" } },
  "08-site-panel": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end" }, 3: { pos: "inside", align: "end", label: false }, 4: { pos: "inside", align: "end", label: false } },
  "09a-disaster-panel": { 1: { pos: "inside", align: "end", label: false }, 2: { pos: "inside", align: "end" }, 3: { pos: "inside" } },
  "09b-disaster-owners": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end" } },
  "09c-disaster-unlisted": { 1: { pos: "bottom", align: "end" } },
  "09d-disaster-other-sites": { 1: { pos: "inside", align: "end" } },
  "10a-country-panel": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end" } },
  "10b-owner-panel": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end", label: false } },
  "11a-countries-table": { 4: { pos: "inside", at: 0.3 }, 5: { pos: "inside", at: 0.3 } },
  "11b-owners-table": { 2: { pos: "inside", at: 0.3 }, 3: { pos: "inside", align: "end", label: false } },
  "12a-how": { 1: { pos: "inside", align: "end", label: false }, 2: { pos: "inside", align: "end", label: false }, 3: { pos: "inside", align: "end" } },
  "12b-source": { 1: { pos: "right" }, 2: { pos: "right" } },
  "13-loading": { 2: { pos: "inside", align: "end" } },
  "14a-upload-empty": { 1: { align: "end" }, 2: { pos: "below" } },
  "14b-upload-amazon": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end" }, 3: { pos: "inside", align: "end" }, 4: { pos: "inside", at: 0.5 } },
  "14c-upload-amazon-name": { 1: { pos: "below" }, 2: { pos: "right" } },
  "14d-upload-facilities": { 1: { pos: "inside", align: "end" }, 2: { pos: "inside", align: "end" }, 3: { pos: "inside", align: "end" } },
  "15a-network-adidas": { 1: { align: "end" }, 4: { pos: "inside", at: 0.47 }, 5: { pos: "below" }, 6: { pos: "left", nudge: [-36, 0] } },
  "15b-network-paxar": { 2: { pos: "below" }, 3: { pos: "left" } },
  "15c-network-henkel": { 1: { pos: "below" } },
  "15d-network-samsung": { 1: { at: 0.6 } },
};
const pct = (v, of) => `${((100 * v) / of).toFixed(3)}%`;
function callout(m, s, short, o) {
  const pos = o.pos ?? "above";
  const align = o.align ?? (m.x / s.width > 0.72 ? "end" : "start");
  let ax, ay, tx, ty;
  if (pos === "left" || pos === "right") {
    ax = pos === "left" ? m.x : m.x + m.w; tx = pos === "left" ? "calc(-100% - 9px)" : "9px";
    ay = m.y + m.h / 2; ty = "-50%";
  } else {
    const inner = pos === "inside" || pos === "bottom";
    if (o.at != null) { ax = m.x + m.w * o.at; tx = "0px"; }
    else if (align === "end") { ax = m.x + m.w; tx = inner ? "calc(-100% - 4px)" : "calc(-100% + 3px)"; }
    else { ax = m.x; tx = inner ? "4px" : "-3px"; }
    ay = pos === "above" || pos === "inside" ? m.y : m.y + m.h;
    ty = pos === "above" ? "calc(-100% - 7px)" : pos === "below" ? "7px" : pos === "bottom" ? "calc(-100% - 4px)" : "4px";
  }
  const [dx, dy] = o.nudge ?? [0, 0];
  const t = `translate(calc(${tx} + ${dx}px), calc(${ty} + ${dy}px))`;
  return `<span class="mk pin" style="left:${pct(ax, s.width)};top:${pct(ay, s.height)};transform:${t}"><b>${m.n}</b>${o.label === false ? "" : esc(short)}</span>`;
}
function figure(st) {
  const s = shots[st.shot];
  const marks = st.marks ?? {};
  const place = PLACE[s.name] ?? {};
  const nums = s.markers.map((m) => String(m.n));
  const written = Object.keys(marks);
  if (nums.join() !== written.join()) throw new Error(`${s.name}: markers ${nums} but text for ${written}`);
  for (const n of Object.keys(place)) if (!nums.includes(n)) throw new Error(`${s.name}: placement for unknown marker ${n}`);
  // a callout above a box near the top edge (or below one near the bottom) needs room: a strip above (below) the screenshot
  const band = s.markers.some((m) => (place[m.n]?.pos ?? "above") === "above" && m.y < 40);
  const bandBelow = s.markers.some((m) => place[m.n]?.pos === "below" && m.y + m.h > s.height - 40);
  const overlays = s.markers.map((m) =>
    `<span class="mk box" style="left:calc(${pct(m.x, s.width)} - 3px);top:calc(${pct(m.y, s.height)} - 3px);width:calc(${pct(m.w, s.width)} + 6px);height:calc(${pct(m.h, s.height)} + 6px)"></span>`
    + callout(m, s, marks[m.n][0], place[m.n] ?? {})).join("");
  return `<figure class="shot" id="fig-${s.name}">
  <div class="frame${band ? " band" : ""}${bandBelow ? " band-b" : ""}"><div class="img" style="aspect-ratio:${s.width}/${s.height}">
    <img src="assets/${s.file}" width="${s.width}" height="${s.height}" alt="${esc(s.title)}" loading="lazy">
    ${overlays}
  </div></div>
  <figcaption><span class="fig">Figure ${figNo[s.name]}</span> ${esc(s.title)} <a class="full" href="assets/${s.file}">Full size</a></figcaption>
</figure>`;
}

function step(st, i, numbered) {
  const marks = Object.entries(st.marks ?? {}).map(([n, [short, text]]) =>
    `<li><span class="num">${n}</span><div><b>${esc(short)}.</b> ${refs(text)}</div></li>`).join("\n");
  const code = (st.code ?? []).map((c) => `<p class="code"><span class="tag">Code only</span> ${refs(c)}</p>`).join("\n");
  const heading = st.heading ? `<h3>${numbered ? `<span class="step">Step ${i}</span> ` : ""}${esc(st.heading)}</h3>` : "";
  return `<div class="block">
${heading}
${figure(st)}
<div class="notes">
  <p class="shown"><span class="label">Shown</span> ${refs(st.shown)}</p>
  ${marks ? `<ol class="marks">${marks}</ol>` : ""}
  <div class="flow">
    <p><span class="label">What you do</span> ${refs(st.do)}</p>
    <p><span class="label">What happens next</span> ${refs(st.next)}</p>
  </div>
  ${code}
</div>
</div>`;
}

const workflow = (s) => s.id === "where-exposed" || s.id === "disaster-hits" || s.id === "add-list" || s.id === "review-match";
const sectionHtml = SECTIONS.map((s, k) => {
  const first = s.id === "disaster-hits" ? 2 : 1;               // "A disaster hits": step 1 is in the intro (no screenshot)
  return `<section id="${s.id}">
<h2><span class="secno">${k + 2}</span>${esc(s.title)}</h2>
${refs(s.intro)}
${s.steps.map((st, i) => step(st, i + first, workflow(s))).join("\n")}
${s.after ? refs(s.after) : ""}
</section>`;
}).join("\n");

const toc = [
  ["cover", "1", "About this guide"],
  ...SECTIONS.map((s, k) => [s.id, String(k + 2), s.title]),
  ["good-to-know", String(SECTIONS.length + 2), "Good to know"],
].map(([id, n, t]) => `<li><a href="#${id}"><span class="tocno">${n}</span>${esc(t)}</a></li>`).join("\n");

const figList = order.map((n) => `<li><a href="#fig-${n}">Figure ${figNo[n]}</a> ${esc(shots[n].title)}</li>`).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supplier Risk Map Guide</title>
<style>
:root { --ink:#1F2A2E; --muted:#56656A; --line:#DDE3E5; --bg:#F6F7F5; --paper:#FFFFFF; --navy:#1F3A5F; --pin:#C2255C; --code:#5F3DC4; --codebg:#F4F1FD; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1180px; margin: 0 auto; padding: 0 24px 120px; }
a { color: var(--navy); text-underline-offset: 2px; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #EDF0F1; padding: 1px 5px; border-radius: 4px; }
h1 { font-size: 44px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 16px; }
h2 { font-size: 28px; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 12px; display: flex; align-items: baseline; gap: 12px; }
h3 { font-size: 19px; margin: 0 0 12px; }
section { padding-top: 56px; scroll-margin-top: 12px; }
section > p { max-width: 78ch; }
.secno { font-size: 15px; font-weight: 700; color: #fff; background: var(--navy); border-radius: 8px; padding: 2px 9px; }
.step { font-size: 13px; font-weight: 700; color: var(--navy); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 6px; }

.cover { padding: 64px 0 8px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }
.lede { font-size: 20px; line-height: 1.5; max-width: 62ch; margin: 0 0 24px; }
.grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start; }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; }
.card h3 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 10px; }
.card p, .card ul { margin: 0 0 10px; }
.card ul { padding-left: 20px; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; font-weight: 600; }
.live { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: #FFF4E6; color: #7A4100; font-size: 14px; }
.legend-demo { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
nav.toc ol { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 24px; }
nav.toc li { break-inside: avoid; margin: 0 0 6px; }
nav.toc a { text-decoration: none; display: flex; gap: 10px; align-items: baseline; }
nav.toc a:hover { text-decoration: underline; }
.tocno { min-width: 22px; font-weight: 700; color: var(--muted); }
details.figs { margin-top: 12px; font-size: 14px; }
details.figs ol { columns: 2; column-gap: 24px; padding-left: 0; list-style: none; margin: 8px 0 0; }
details.figs li { break-inside: avoid; margin-bottom: 4px; }

.block { margin: 36px 0 0; }
figure.shot { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 12px; box-shadow: 0 1px 2px rgba(31,42,46,0.06); }
.frame { width: 100%; }
.frame.band { padding-top: 34px; }
.frame.band-b { padding-bottom: 34px; }
.img { position: relative; width: 100%; }
.img img { display: block; width: 100%; height: auto; border-radius: 8px; }
figcaption { display: flex; gap: 10px; align-items: baseline; font-size: 14px; color: var(--muted); padding: 10px 4px 0; }
figcaption .fig { font-weight: 700; color: var(--ink); }
figcaption .full { margin-left: auto; font-size: 13px; }
.box { position: absolute; border: 2px solid var(--pin); border-radius: 6px; box-shadow: 0 0 0 2px rgba(255,255,255,0.9); pointer-events: none; }
.pin { position: absolute; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; background: var(--pin); color: #fff; font-size: 12px; font-weight: 600; line-height: 1; padding: 3px 9px 3px 3px; border-radius: 999px; box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.25); pointer-events: none; z-index: 1; }
.pin b, .num { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #fff; color: var(--pin); font-size: 11px; font-weight: 800; flex: none; }
.num { background: var(--pin); color: #fff; width: 22px; height: 22px; font-size: 12px; margin-top: 2px; }

.notes { padding: 16px 4px 0; }
.notes p { margin: 0 0 10px; max-width: 86ch; }
.label { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-right: 6px; }
ol.marks { list-style: none; padding: 0; margin: 6px 0 14px; display: grid; gap: 8px; }
ol.marks li { display: flex; gap: 10px; align-items: flex-start; max-width: 92ch; }
.flow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin: 4px 0 10px; }
.flow p { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
.flow .label { display: block; margin-bottom: 2px; }
.code { background: var(--codebg); border-left: 3px solid var(--code); border-radius: 8px; padding: 10px 14px; margin: 10px 0; max-width: 92ch; }
.code ul { margin: 6px 0 0; padding-left: 20px; }
.tag { display: inline-block; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--code); margin-right: 6px; }
.src { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--code); white-space: nowrap; }

ul.know { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
ul.know li { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
ul.know b { display: block; margin-bottom: 4px; }
footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }

#hide-marks { position: absolute; opacity: 0; pointer-events: none; }
.toggle { position: fixed; right: 20px; bottom: 20px; z-index: 10; background: var(--navy); color: #fff; border-radius: 999px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2); user-select: none; }
.toggle::after { content: "Hide markers"; }
#hide-marks:checked ~ .toggle::after { content: "Show markers"; }
#hide-marks:checked ~ main .mk { display: none; }
#hide-marks:focus-visible ~ .toggle { outline: 3px solid var(--pin); outline-offset: 2px; }
@media (max-width: 860px) { .grid, .flow, ul.know { grid-template-columns: 1fr; } nav.toc ol, details.figs ol { columns: 1; } h1 { font-size: 34px; } }
@media print { .toggle { display: none; } section { break-before: page; } .block { break-inside: avoid; } }
</style>
</head>
<body>
<input type="checkbox" id="hide-marks">
<label for="hide-marks" class="toggle" title="Show or hide the numbered markers on the screenshots"></label>
<main>
<header class="cover" id="cover">
  <p class="eyebrow">Product guide</p>
  <h1>Supplier risk map</h1>
  <p class="lede">The Supplier risk map shows a company where its suppliers' sites are concentrated, which owner companies hold many of them, and which sites are inside a current disaster area. It is for the company's own procurement and risk team, and its Chief Procurement Officer.</p>
  <div class="grid">
    <div class="card">
      <h3>What it uses</h3>
      <p>Supplier lists from Open Supply Hub, loaded by upload; current disaster areas from GDACS, read live; and company records from GLEIF, whose parent companies show only after a person confirms a match.</p>
      <p>The demo companies are adidas, Nike, Apple, Samsung and Amazon.com, Inc. They are stand-ins, used because their supplier lists are public on Open Supply Hub; this guide does not claim they are FourKites customers.</p>
      <h3 style="margin-top:18px">How to read this guide</h3>
      <ul>
        <li>Every screenshot is from the running app. Each numbered marker <span class="legend-demo"><span class="pin" style="position:static"><b>1</b>Name</span></span> sits on the element its note explains; its box was measured on the page when the screenshot was taken.</li>
        <li>Each screenshot is followed by what it shows, what each marked control does, what you do, and what happens next.</li>
        <li><span class="tag">Code only</span> marks behaviour that is in the app's source code but not shown in a screenshot.</li>
        <li>Nothing was confirmed, rejected, undone, loaded or refreshed for this guide. Buttons that would change data are described, not clicked.</li>
        <li>The button at the bottom right hides or shows the markers.</li>
      </ul>
    </div>
    <div class="card">
      <h3>Captured</h3>
      <dl class="facts">
        <dt>Date</dt><dd>${capturedUtc}${capturedLocal ? ` (${esc(capturedLocal)})` : ""}</dd>
        <dt>Header showed</dt><dd>${esc(chip)}</dd>
        <dt>Screen</dt><dd>${esc(cap.viewport.replace("x", " × "))} px, at ${cap.scale}×</dd>
        <dt>Browser</dt><dd>Headless Chrome ${esc(chrome)}</dd>
        <dt>App version</dt><dd>commit ${esc(cap.app_commit)}</dd>
        <dt>Screenshots</dt><dd>${order.length}</dd>
      </dl>
      <p class="live">Disaster data is live. On another day the disaster areas, the sites inside them, and every sentence and count that mentions them will differ from these screenshots.</p>
    </div>
  </div>
</header>

<section id="contents" style="padding-top:40px">
  <div class="card">
    <h3>Contents</h3>
    <nav class="toc"><ol>
${toc}
    </ol></nav>
    <details class="figs"><summary>All ${order.length} screenshots</summary><ol>
${figList}
    </ol></details>
  </div>
</section>

${sectionHtml}

<section id="good-to-know">
<h2><span class="secno">${SECTIONS.length + 2}</span>Good to know</h2>
<p>Limits that the app itself shows on screen.</p>
<ul class="know">
${GOOD_TO_KNOW.map(([b, t]) => `<li><b>${esc(b)}</b>${refs(t)}</li>`).join("\n")}
</ul>
</section>

<footer>Screenshots captured ${capturedUtc} from commit ${esc(cap.app_commit)}. Built from <code>docs/walkthrough/assets/manifest.json</code> by <code>docs/walkthrough/capture/build.mjs</code>; screenshots by <code>capture.mjs</code>.</footer>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`index.html: ${order.length} figures, ${manifest.shots.reduce((n, s) => n + s.markers.length, 0)} markers, ${(html.length / 1024).toFixed(1)} KB`);
