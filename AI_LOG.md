# AI log

`[author: confirm these in your own words]`

The brief (Section 7.1): "Where your coding agents were confidently wrong, and how you caught it. Two or three specific incidents is plenty. Generic observations about hallucination tell us nothing."

Incidents 1 and 2 were caught during planning, and incident 3 by an independent check after the build.

---

## 1. An incomplete GLEIF file was nearly used

- **What the tool claimed:** the GLEIF file on disk was complete, and ready to match our owner and site names against.
- **How we caught it:** we compared its row count with GLEIF's published count for that date. The file had 2,478,264 records; GLEIF published 3,438,994.
- **What was done:** the repo uses the 29 Sep 2026, 16:00 file. `scripts/verify_inputs.py` checks its record count (3,446,215) on every full run.

## 2. The hazard count included forecast "uncertainty cones"

- **What the tool claimed:** 91 sites were inside current disaster areas.
- **How we caught it:** we read GDACS's own polygon labels. Some areas were forecast uncertainty cones, not affected areas. The true count was 88.
- **What was done:** only GDACS's *affected* areas count. Forecast areas, uncertainty cones, distance circles and the flood "Global area" are not counted (ARCHITECTURE.md, section 5).

## 3. A missing site was put down to live data changing

- **What the tool claimed:** Nike had 2 sites inside current disaster areas, and the earlier count of 3 was a live GDACS change.
- **How we caught it:** an independent check against live GDACS found Nike 3, with the same flood events and episodes as the app, plus BR2019085Q71GZV inside drought DR1015915, episode 1. In the app's database the drought was stored with `is_current` false: the refresh had not seen it in the event list. GDACS's list read with all six types at once (19 pages) had 1,844 rows but only 1,827 distinct events. Its pages are sorted only by end date, so tied events repeat across pages, and others are on no page. The drought-only list had DR1015915 with `iscurrent` true. That read missed 12 current events in all (11 wildfires and this drought).
- **What was done:** the refresh reads the list once per event type, and counts rows repeated across pages. Live after the fix: adidas 5 and Nike 3, the same sites and episodes as the independent check. `test_a_drought_skipped_by_the_all_types_list_is_still_found` fails on the old code and passes on the new. Still open: the wildfire list (13 pages) repeated 24 rows, so some wildfires can still be missed. The screen says so.
