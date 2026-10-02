# Geographic Supplier Risk Intelligence

> Sections 4 and 7 describe the final build, checked on 30 Sep 2026.

## 1. What it is

- **What it does:** a company uploads its supplier list and sees, on a map, where its suppliers are concentrated, which owner companies hold many of its sites, and which sites sit inside a current disaster area.
- **Who uses it:** the company's own team: "Procurement Managers, Supply Chain Risk Analysts and Strategic Sourcing Managers", plus the CPO, who "wants a single answer about where the company is exposed".
- **What it uses:** the Open Supply Hub file (uploaded), GLEIF's entity and relationship files (offline) and GLEIF's API (live, for companies other than adidas and Nike), and GDACS disaster alerts (live).

## 2. What it does

| Part of the problem statement | In the MVP |
|---|---|
| Supplier risk concentration on an interactive map | ✅ Each country's share of the company's sites (or estimated workers), marked High or Watch |
| Single-source dependency | ✅ As **owner dependency**: owner companies that hold a large share of the sites. The data has no materials, so it cannot be done by material |
| Risk overlays on a global network map | ✅ Current disaster areas (GDACS), site warnings, and links site → owner → parent company |
| Alternative supplier identification | ❌ Not built: the data does not say what each site makes |

Location is shown by country only. A Vietnam 2025 province mapping is in the repo: prepared, not used in the MVP.

## 3. Demo data

The demo uses the public supplier lists of **adidas, Nike, Apple and Samsung** from Open Supply Hub. We do not claim they are FourKites customers.

| | adidas | Nike | Apple | Samsung |
|---|---|---|---|---|
| Open sites | 766 | 625 | 749 | 187 |
| Share basis | workers | workers | sites | sites |
| Largest country | VN 31.5% | VN 40.6% | CN 45.9% | KR 31.0% |
| Countries at High | 3 | 3 | 2 | 4 |
| Largest owner (on the share basis) | POU CHEN 7.4% (Watch) | FENG TAY 9.3% (Watch) | INTEL, 9 sites (1.2%) | HITACHI, 9 sites (4.8%) |
| Sites inside a current disaster area | 5 (Green) | 3 (Green) | 0 | 0 |

- **Disaster counts** (last row) are live GDACS data as of 30 Sep 2026. A later run gives different counts. The other rows are checked by the tests.
- **Certificate warnings** (WRAP, BSCI, SLCP) are checked against the date the list was loaded, so their counts change with the load date.

**GLEIF:** the 440 candidates of the GLEIF file (adidas and Nike names) are rated with the written rules, like every company's: 33 likely, 201 possible, 206 unlikely (the file's own levels, kept for reference: 30 / 48 / 362). Among the likely ones: Coats Group PLC, Avery Dennison Corporation and SAYE S.P.A. as parent companies in GLEIF (5 likely LEIs have a parent record). A match is shown only after a person confirms it. Other companies get candidates from GLEIF's API (live run, 2 Oct 2026, with the first rules: Apple 4 likely / 41 possible / 158 unlikely; Samsung 8 / 49 / 235; Amazon 50 / 91 / 279; DECISIONS #2).

## 4. What works

Only features tested on the final build. Tests: `backend/tests/` (132, pytest) and `frontend/src/summary.test.tsx`, `uploadLists.test.ts`, `networkGraph.test.ts` and `format.test.ts` (20, vitest). The screen was checked in headless Chrome with a script that is not in the repo.

| Feature | Tested by |
|---|---|
| Starts from a clean clone with one command, and seeds the 4 demo companies on first start | A fresh `git clone` and an empty database volume (section 7); `test_routes` |
| Load and clean (R1–R4): open sites, estimated workers, owner names, warnings (same coordinates, owner conflict, certificates); `claim_*` columns dropped | `test_clean.py`; `test_no_stored_table_has_a_claim_column` |
| Country shares on the share basis, High / Watch, thresholds as request parameters; equal shares ordered by country name, so the order is the same on every load | `test_section_8_numbers`; `test_thresholds_are_request_parameters`; `test_measures_order.py` |
| Owner shares; owners with all their sites in one country | `test_largest_owner_on_the_share_basis`; `test_routes` |
| One-sentence summary, and every number with its base | `test_samsung_sentence_follows_appendix_c3`; `test_every_number_has_its_base`; `test_hazard_levels_r9` |
| GLEIF candidates and parents, shown only after a "yes" verdict (on the Company network page, or in the CSV): adidas and Nike from the GLEIF file | `test_gleif.py`; `test_network.py` |
| GLEIF candidates for any other company, from GLEIF's API: after "Load this company", or "Find GLEIF candidates, about N minutes" on the Company network page; one search per owner name on its core name (no commas, no legal-form words), at most 10 kept, rated likely / possible / unlikely by the written rules (legal name and other names; a sole proprietor, fund or lapsed registration at most possible) with flags, the same rules as adidas's and Nike's; at most 1 request a second, every answer cached; in the background with progress on the page and in the header; parents fetched only after a confirm; nothing confirmed automatically | `test_gleif_api.py`, with a fake GLEIF: commas never sent, the core-name search, the rating rules (other names, DE CV / SRL / S R L / PTE, the cap; the file's candidates with the rules and their own level kept; results rated with older rules rated again from the cache), 10 kept, 1 request a second, cache reuse, a 429 retry, a failed search resuming, parents only after a confirm, a shared candidate with one verdict, adidas and Nike unchanged, numbers unchanged. Live, 2 Oct 2026: Apple 41 names in 45 s, Samsung 102 in 103 s, Amazon 273 in 308 s; in the browser at 1440 px the button, the progress (also on the map page), and a confirm with its parent fetch |
| Company network page: the GLEIF candidates of the company chosen in the top selector (adidas 221, Nike 345; 126 are both's and say "applies to adidas and Nike"; 440 in all, rated with the written rules: 33 likely, 201 possible, 206 unlikely; the file's own level is shown where it differs), with a review-level filter and a search box; a company with no candidates yet gets "Find GLEIF candidates, about N minutes"; Confirm / Reject / Undo; a graph (React Flow) from company to sites (and owner) to the GLEIF company, dashed while a candidate, solid once confirmed, no line once rejected, and the direct and top parents only when confirmed; at most 15 site nodes, then "+N more"; verdicts saved in the database (table `gleif_verdict`) and kept after a restart; "Download verdicts (CSV)"; yes and no from two candidates on one site link is a conflict: not confirmed, and marked "conflicting verdicts – needs review" | `test_network.py` (the list per company: adidas 221, Nike 345, Apple, Samsung and an uploaded company 0; confirm, reject, undo, the conflict case, verdicts and an uploaded company kept after a restart, PT. Paxar Indonesia → AVERY DENNISON CORPORATION, numbers unchanged after confirming all 30 likely candidates); `networkGraph.test.ts`. In the browser at 1440 px: PT. Paxar Indonesia before and after Confirm; a rejected and an undone candidate; the 17-site owner AVERY DENNISON. After `docker compose restart backend`: the verdict, the parent in the map's site panel and an uploaded company are kept. A database made by the previous commit (no `gleif_verdict` table, one uploaded company) started with this code without a reset: the table was created, and every company's numbers were unchanged |
| GDACS refresh: one list read per event type, paging, 30-day window, all alert levels, affected areas only (R8), refetch only changed events; rows GDACS repeats across pages are counted and shown | `test_hazards.py`, with a mocked GDACS, including a drought the all-types list skips (`test_a_drought_skipped_by_the_all_types_list_is_still_found`). Live, 30 Sep 2026: 251 current events, 404 affected areas; adidas 5 and Nike 3 sites inside, the same sites and episodes as an independent check |
| Disaster levels (Orange / Red → High, Green → Watch), and event → sites → owners → those owners' other sites | `test_hazard_levels_r9`; `test_hazard_multi_hop` |
| A site counts as inside an event only if its country is in the event's GDACS `affectedcountries` (an empty list: the area alone); a site inside the area in an unlisted country is shown on the disaster and site panels as "inside the area, but GDACS does not list <country> as affected" | `test_a_site_inside_the_area_in_an_unlisted_country_is_not_counted`; `test_an_event_with_no_country_list_uses_the_area_alone`; `test_refresh_stores_each_events_affected_countries`. Live, 2 Oct 2026, on a database made by the previous commit (the column was added on start, no reset): site–event pairs Amazon 83 → 36, adidas 27 → 22, Apple 16 → 15, Nike 4 → 3, Samsung 3 → 3, the same as a read-only check beforehand; the drought panel and a UK site's panel in the browser at 1440 px |
| GDACS unreachable: each failed request (a network error, a 5xx, 408 or 429; not other 4xx) is tried again after 2 s and 5 s; then "Disaster data unavailable", the error's type and details in the status and the log, and the rest keeps working | `test_gdacs_unreachable_keeps_the_app_working`, `test_a_request_that_fails_once_is_retried_and_the_refresh_succeeds`, `test_a_request_that_always_fails_is_tried_3_times`, `test_a_failed_refresh_reports_the_error_type_and_details`, `test_a_404_is_not_retried`, `test_a_429_is_retried`; in the browser, with `www.gdacs.org` blocked in the backend container |
| Upload: file in → list strings with site counts. The company on every row of the file is filled in; otherwise the 5 contributors on the most rows are suggested. Picking one ticks only its lists with the latest year in their name, marks them current, and fills in the company name; its other lists can be ticked by hand, and all can be changed. A search box over the lists; anonymous types and "(Claimed)" entries hidden unless "Show all lists" is ticked. Nothing loads until "Load this company". One company's upload changes only that company | `test_api_upload.py`; `test_contributors.py` (on each demo file the current lists picked equal `demo_companies.json`, and loading with the pre-filled picks gives the seed's numbers); `uploadLists.test.ts`. In the browser at 1440 px: an Amazon download (not in the repo) filled in and loaded, 1,732 sites; the adidas + Nike file with 5 suggestions; the Samsung file loaded as a new company |
| Screen: company selector; the one-sentence summary; three answer cards (countries, owner companies, disasters now); an interactive map (MapLibre, no map tiles: countries at High / Watch, clustered sites, disaster areas, fly-to with tilt, flat map or globe); site, owner, disaster and country panels; Countries and Owner companies tables (sortable, searchable, paged); "How these numbers are worked out" and "Source and limits of the data" | `frontend/src/summary.test.tsx` (the three cards with the adidas numbers). Headless Chrome with WebGL at 1440 and 390 px: the map renders; the numbers shown for the 4 companies are the same as the previous screen on the same data; panels, map moves and globe view; keyboard access; reduced motion; the upload flow; no page-level sideways scroll; no console errors. The production build (`npm run build`, then `npm run preview`) renders the map too |
| Map: "Loading map…" until the outlines and sites are drawn; Reset view fits the company's sites (flat map: their bounds; globe: centred on them); cluster counts on the flat map and the globe, never over single dots at close zoom | Headless Chrome at 1440 px: the message on first load; Reset view for adidas (Southeast Asia in view) and Samsung, flat and globe; counts on the globe; near Istanbul, no count over the flood's dots |

## 5. What does not work / not built

| Not built | Why |
|---|---|
| Alternative suppliers | The data does not say what each site makes |
| Single-source by material | No material data |
| Product grouping | Product words are merged across every contributor, so they are shown only as information |
| Supplier-to-supplier links | The data does not say which site supplies which |
| Tier labels | adidas's and Nike's lists do not define tiers, and the Apple and Samsung list names do not mention them. Each list's own name is shown instead |
| Near-real-time supplier lists | Lists are only as fresh as their publishers make them |
| Performance trends | No supplier performance data |
| Per-company login | Demo only |

Raw-material tracing needs the company's own supplier data: supplier, location, material or part, and which site it supplies.

## 6. Known limits

- **Every number shows its base**, for example "owner known for 66 of 749 sites".
- **Owner names are not merged by spelling.** Nike's 3 "SHAHI" sites and adidas's 4 "SHAHI EXPORTS" sites count as different owners.
- **Lists are dated:** Apple 2019, Samsung 2021, Nike February 2024 (adidas January and April 2026).
- **GDACS alerts are automatic** and not reviewed by people. Confirm them before making decisions. Source: Global Disaster Awareness and Coordination System, GDACS.
- **Droughts cover very large areas for months.** On 2 Oct 2026 drought DR1018332 (Orange) had been current since 21 Dec 2025, over about 1.76 million km² (GDACS: "medium impact for agricultural drought"), and its area crosses borders. A site counts only if GDACS lists its country as affected; 54 UK sites inside that area are listed on its panel but not counted.
- **GDACS's event list can skip events when paging.** Querying one type at a time fixed this for five types; wildfires can still be missed (on 30 Sep 2026 the wildfire list repeated 24 rows over 13 pages). The screen shows how many events may be missing.
- **The map uses only the committed Natural Earth 1:50m outlines**, with no map tiles, so coastlines are coarse when zoomed in to a site.
- **Every country in the demo data has an outline at 1:50m.** A country with no outline (none today) would be named under the map, and its sites would still show.
- **Parent names show as written in GLEIF's file**, in upper case (for example COATS GROUP PLC).
- **A new GLEIF API search needs the internet**, and takes about a second per owner name not searched before (Amazon: about 5 minutes). Cached answers do not need the internet.
- **Generic one-word owner names (for example DELTA, FLEX, MAS) inflate the "possible" list.**
- **The GLEIF API search matches legal names only** ("contains"). Groups whose GLEIF legal name is in another script are not found by their English name (on 2 Oct 2026: LG DISPLAY, MURATA MANUFACTURING, TOKYO ELECTRON), and a subsidiary can come first (WISTRON: Wistron Hong Kong). Every candidate waits for a person's verdict.

## 7. How to run from a clean clone

Needs Docker with Compose. Only committed files are used (`data/demo`, `data/reference`).

```sh
git clone https://github.com/abhifourkites/geo-risk.ai.git
cd geo-risk.ai
docker compose up
```

- Open http://localhost:5173 (API: http://localhost:8000/api/health).
- The first start loads the 4 demo companies. Each start also runs one GDACS refresh in the background; until it finishes, the screen says "Checking for current disasters…".
- **Tests**, in a second terminal: `docker compose run --rm backend pytest`. They use a separate database (`georisk_test`) and never call GDACS. **Frontend check:** `docker compose run --rm --no-deps frontend npm test`.
- **After a code change:** `docker compose up --build`. **Start with an empty database:** `docker compose down -v`.
- **GLEIF API searches** run in the backend and need the internet (api.gleif.org). After a restart, a search that was running continues where it stopped.
- **GLEIF verdicts:** on the Company network page (Confirm / Reject / Undo). They are saved in the database, applied at once, and kept after a restart; "Download verdicts (CSV)" saves them to a file. The slice file's `person_verdict (same company? yes / no)` column in `data/reference/gleif_slice_for_our_data.csv` is still read on each start; a verdict given on the page is used over it.
- **Optional full input check:** `python3 -B scripts/verify_inputs.py` needs `data/raw/` (the original downloads). That folder is git-ignored (large files, and personal contact columns), so this check cannot run from a clean clone.

## 8. Hours spent

`[author to fill]`
