# Geographic Supplier Risk Intelligence

> Sections 4 and 7 describe the final build, checked on 30 Sep 2026.

## 1. What it is

- **What it does:** a company uploads its supplier list and sees, on a map, where its suppliers are concentrated, which owner companies hold many of its sites, and which sites sit inside a current disaster area.
- **Who uses it:** the company's own team: "Procurement Managers, Supply Chain Risk Analysts and Strategic Sourcing Managers", plus the CPO, who "wants a single answer about where the company is exposed".
- **What it uses:** the Open Supply Hub file (uploaded), GLEIF's entity and relationship files (offline), and GDACS disaster alerts (live).

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

**GLEIF:** 30 likely name matches (from the adidas and Nike names). 3 have a parent company in GLEIF: Coats Group PLC, Avery Dennison Corporation and SAYE S.P.A. A match is shown only after a person confirms it.

## 4. What works

Only features tested on the final build. Tests: `backend/tests/` (54, pytest) and `frontend/src/summary.test.tsx` (5, vitest). The screen was checked in headless Chrome with a script that is not in the repo.

| Feature | Tested by |
|---|---|
| Starts from a clean clone with one command, and seeds the 4 demo companies on first start | A fresh `git clone` and an empty database volume (section 7); `test_routes` |
| Load and clean (R1–R4): open sites, estimated workers, owner names, warnings (same coordinates, owner conflict, certificates); `claim_*` columns dropped | `test_clean.py`; `test_no_stored_table_has_a_claim_column` |
| Country shares on the share basis, High / Watch, thresholds as request parameters | `test_section_8_numbers`; `test_thresholds_are_request_parameters` |
| Owner shares; owners with all their sites in one country | `test_largest_owner_on_the_share_basis`; `test_routes` |
| One-sentence summary, and every number with its base | `test_samsung_sentence_follows_appendix_c3`; `test_every_number_has_its_base`; `test_hazard_levels_r9` |
| GLEIF candidates (adidas and Nike only) and parents, shown only after a "yes" verdict in the CSV | `test_gleif.py` |
| GDACS refresh: one list read per event type, paging, 30-day window, all alert levels, affected areas only (R8), refetch only changed events; rows GDACS repeats across pages are counted and shown | `test_hazards.py`, with a mocked GDACS, including a drought the all-types list skips (`test_a_drought_skipped_by_the_all_types_list_is_still_found`). Live, 30 Sep 2026: 251 current events, 404 affected areas; adidas 5 and Nike 3 sites inside, the same sites and episodes as an independent check |
| Disaster levels (Orange / Red → High, Green → Watch), and event → sites → owners → those owners' other sites | `test_hazard_levels_r9`; `test_hazard_multi_hop` |
| GDACS unreachable: "Disaster data unavailable", and the rest keeps working | `test_gdacs_unreachable_keeps_the_app_working`; in the browser, with `www.gdacs.org` blocked in the backend container |
| Upload: file in → list strings with site counts → pick lists, mark current → load. One company's upload changes only that company | `test_api_upload.py`; in the browser (the Samsung file loaded as a new company) |
| Screen: company selector; the one-sentence summary; three answer cards (countries, owner companies, disasters now); an interactive map (MapLibre, no map tiles: countries at High / Watch, clustered sites, disaster areas, fly-to with tilt, flat map or globe); site, owner, disaster and country panels; Countries and Owner companies tables (sortable, searchable, paged); "How these numbers are worked out" and "Source and limits of the data" | `frontend/src/summary.test.tsx` (the three cards with the adidas numbers). Headless Chrome with WebGL at 1440 and 390 px: the map renders; the numbers shown for the 4 companies are the same as the previous screen on the same data; panels, map moves and globe view; keyboard access; reduced motion; the upload flow; no page-level sideways scroll; no console errors |

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
- **GDACS's event list can skip events when paging.** Querying one type at a time fixed this for five types; wildfires can still be missed (on 30 Sep 2026 the wildfire list repeated 24 rows over 13 pages). The screen shows how many events may be missing.
- **The map uses only the committed Natural Earth 1:110m outlines**, with no map tiles, so coastlines are coarse when zoomed in to a site.
- **Small countries have no outline** on the 1:110m map: MT, SG, MU, HK and MC in the demo data. Their sites still show as dots, and the screen names any of them at High or Watch (Samsung: SG, Watch).
- **Parent names show as written in GLEIF's file**, in upper case (for example COATS GROUP PLC).

## 7. How to run from a clean clone

Needs Docker with Compose. Only committed files are used (`data/demo`, `data/reference`).

```sh
git clone https://github.com/abhifourkites/geo-risk.ai.git
cd geo-risk.ai
git checkout MDM-3/mvp-architecture-docs
docker compose up
```

- Open http://localhost:5173 (API: http://localhost:8000/api/health).
- The first start loads the 4 demo companies. Each start also runs one GDACS refresh in the background; until it finishes, the screen says "Checking for current disasters…".
- **Tests**, in a second terminal: `docker compose run --rm backend pytest`. They use a separate database (`georisk_test`) and never call GDACS. **Frontend check:** `docker compose run --rm --no-deps frontend npm test`.
- **After a code change:** `docker compose up --build`. **Start with an empty database:** `docker compose down -v`.
- **GLEIF verdicts:** fill `person_verdict (same company? yes / no)` in `data/reference/gleif_slice_for_our_data.csv`, then `docker compose restart backend`. The files are read again on each start.
- **Optional full input check:** `python3 -B scripts/verify_inputs.py` needs `data/raw/` (the original downloads). That folder is git-ignored (large files, and personal contact columns), so this check cannot run from a clean clone.

## 8. Hours spent

`[author to fill]`
