# AI log

`[author: confirm these in your own words]`

The brief (Section 7.1): "Where your coding agents were confidently wrong, and how you caught it. Two or three specific incidents is plenty. Generic observations about hallucination tell us nothing."

All three incidents below were caught during planning.

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

---

## Other incidents

- **Vietnam province name.** A province was stated as "Thua Thien Hue (unchanged)". The resolution names the new province "Hue". Evidence: `data/mappings/vietnam_2025_province_mapping.csv` maps "Thua Thien Hue" to "Hue".
- **A rule stated as failing when it works for one case.** The "earliest date on record" rule was said to fail for all three certificate flags. It works for WRAP, and fails only for BSCI and SLCP. Evidence: `scripts/verify_inputs.py` section 4 prints which flags each rule reproduces.
- **Numbers in the design with no source.** Some numbers came from one-off checks, not from the script. Evidence: the script now prints each of them, and every number in the documents is traced to its output.
