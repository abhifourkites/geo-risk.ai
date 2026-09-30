# AI log

`[author: confirm these in your own words]`

The brief (Section 7.1): "Where your coding agents were confidently wrong, and how you caught it. Two or three specific incidents is plenty. Generic observations about hallucination tell us nothing."

Incidents 1–3 were caught during planning, incidents 4–6 during the build, and incident 7 by an independent check after the build.

---

## 1. An incomplete GLEIF file was nearly used

- **What the tool claimed:** the GLEIF file on disk was complete, and ready to match our owner and site names against.
- **How we caught it:** we compared its row count with GLEIF's published count for that date. The file had 2,478,264 records; GLEIF published 3,438,994.
- **What was done:** the repo uses the 29 Sep 2026, 16:00 file. `scripts/verify_inputs.py` checks its record count (3,446,215) on every full run.

## 2. The hazard count included forecast "uncertainty cones"

- **What the tool claimed:** 91 sites were inside current disaster areas.
- **How we caught it:** we read GDACS's own polygon labels. Some areas were forecast uncertainty cones, not affected areas. The true count was 88.
- **What was done:** only GDACS's *affected* areas count. Forecast areas, uncertainty cones, distance circles and the flood "Global area" are not counted (ARCHITECTURE.md, section 5).

## 3. A hand-copied list of site flags did not match the file

- **What the tool claimed:** the flag counts were 745 / 179 / 7.
- **How we caught it:** we checked the counts against the file before running the test. The file gave 742 / 180 / 7.
- **What was done:** expected values now sit in `scripts/verify_inputs.py`, which reads every count from the files instead of copying it by hand.

## 4. The design said to compare a GDACS field that does not exist

- **What the tool claimed:** the hazard refresh should compare each event's `datetime` to find changed events (`docs/architecture/archive/ARCHITECTURE_detailed.md`, lines 127, 297 and 307).
- **How we caught it:** we read a real event-list response while writing the refresh. Each event has 28 properties, and none is called `datetime`. The date fields are `datemodified`, `fromdate` and `todate`.
- **What was done:** the refresh compares `episodeid` and `datemodified`. `test_refresh_pages_filters_and_compares_datemodified` checks it: an unchanged event is not fetched again, and a changed one is.

## 5. The map painted the whole world as a disaster area

- **What the tool claimed:** the stored disaster areas could be drawn as they came from the database.
- **How we caught it:** a headless-Chrome screenshot of the screen showed the whole globe filled, and no countries. 353 of the 397 stored areas had anticlockwise outer rings. The map library (d3-geo) draws such a ring as "the whole globe minus the shape".
- **What was done:** the drawing query turns the rings clockwise (`ST_ForcePolygonCW`). This is for drawing only; the inside check is unchanged.

## 6. The stack did not start from a clean clone

- **What the tool claimed:** the stack started with `docker compose up`. It had only been run against a database that already existed.
- **How we caught it:** we ran `docker compose up` in a fresh clone with an empty database volume. The backend exited: "connection to server at "172.25.0.2", port 5432 failed: Connection refused". On a new volume, the PostGIS image first runs a temporary server that listens only on the Unix socket. The healthcheck asked over that socket and reported the database ready too early.
- **What was done:** the healthcheck now asks over TCP (`pg_isready -h 127.0.0.1`). From a fresh clone and an empty volume, the stack starts and the tests pass.

## 7. A missing site was put down to live data changing

- **What the tool claimed:** Nike had 2 sites inside current disaster areas, and the earlier count of 3 was a live GDACS change.
- **How we caught it:** an independent check against live GDACS found Nike 3, with the same flood events and episodes as the app, plus BR2019085Q71GZV inside drought DR1015915, episode 1. In the app's database the drought was stored with `is_current` false: the refresh had not seen it in the event list. GDACS's list read with all six types at once (19 pages) had 1,844 rows but only 1,827 distinct events. Its pages are sorted only by end date, so tied events repeat across pages, and others are on no page. The drought-only list had DR1015915 with `iscurrent` true. That read missed 12 current events in all (11 wildfires and this drought).
- **What was done:** the refresh reads the list once per event type, and counts rows repeated across pages. Live after the fix: adidas 5 and Nike 3, the same sites and episodes as the independent check. `test_a_drought_skipped_by_the_all_types_list_is_still_found` fails on the old code and passes on the new. Still open: the wildfire list (13 pages) repeated 24 rows, so some wildfires can still be missed. The screen says so.

---

## Other incidents

- **Vietnam province name.** A province was stated as "Thua Thien Hue (unchanged)". The resolution names the new province "Hue". Evidence: `data/mappings/vietnam_2025_province_mapping.csv` maps "Thua Thien Hue" to "Hue".
- **A rule stated as failing when it works for one case.** The "earliest date on record" rule was said to fail for all three certificate flags. It works for WRAP, and fails only for BSCI and SLCP. Evidence: `scripts/verify_inputs.py` section 4 prints which flags each rule reproduces.
- **Numbers in the design with no source.** Some numbers came from one-off checks, not from the script. Evidence: the script now prints each of them, and every number in the documents is traced to its output.
- **GDACS paging stopped too early.** An early check of the event list read at most 10 pages. On 30 Sep 2026 the list ran to 19 pages. Evidence: the refresh pages until a page has fewer than 100 events (`MAX_PAGES` is only a safety stop), and the mocked-GDACS test checks the stop.
- **Map country codes.** Natural Earth's `ISO_A2` field is "-99" for France, Norway, Kosovo, N. Cyprus and Somaliland, so France and Norway would never be shaded. Evidence: the committed file's properties. The map uses `ISO_A2_EH` (FR, NO, XK).
- **An owner's other sites listed twice.** The disaster panel listed ARIK BEY's 2 other sites 4 times, because 2 of the flood's sites share that owner. Evidence: a duplicate-key warning in the browser console. The query now uses `DISTINCT`, and `test_hazard_multi_hop` checks for duplicates.
- **A test copied a name from the prose, not the file.** A test expected "Coats Group PLC". `data/reference/gleif_parents_checked.csv` has "COATS GROUP PLC". The test was changed to the file's values; the data was not changed.
