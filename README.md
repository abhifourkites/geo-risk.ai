# Geographic Supplier Risk Intelligence

## What it is

A map of where a company's supplier sites are concentrated, which owner companies hold many of them, and which sit inside a current disaster area. It serves the company's own "Procurement Managers, Supply Chain Risk Analysts and Strategic Sourcing Managers", and the CPO, who "wants a single answer about where the company is exposed".

## What it does

- **Upload** an Open Supply Hub supplier list (one company per upload).
- **Concentration:** each country's and owner's share of estimated workers (or sites), marked High (10%) or Watch (5%), with a one-sentence summary. Owner dependency stands in for single-source dependency: the data has no materials.
- **Disasters:** live GDACS areas on the map; disaster → sites → owners → those owners' other sites.
- **Parent companies** from GLEIF, shown once a person confirms the match.

## Demo data

| | adidas | Nike | Apple | Samsung | Amazon |
|---|---|---|---|---|---|
| Open sites | 766 | 625 | 749 | 187 | 1,732 |
| Share basis | workers | workers | sites | sites | sites |
| Largest country | VN 31.5% | VN 40.6% | CN 45.9% | KR 31.0% | CN 24.7% |
| Countries at High | 3 | 3 | 2 | 4 | 3 |
| Largest owner | POU CHEN 7.4% (Watch) | FENG TAY 9.3% (Watch) | INTEL, 9 sites (1.2%) | HITACHI, 9 sites (4.8%) | AVERY DENNISON, 9 sites (0.5%) |
| Sites inside a current disaster area (live GDACS, 3 Oct 2026) | 17 (Orange) | 2 (Orange) | 15 (Orange) | 3 (Orange) | 33 (Orange, Green) |

- The first four load on first start; Amazon is an upload file (`data/demo/amazon.csv`, its 2026 list). We do not claim these companies are FourKites customers.
- GLEIF candidates, likely / possible / unlikely: adidas 25 / 101 / 95 and Nike 10 / 149 / 186 (GLEIF file); Apple 2 / 47 / 154 and Amazon 31 / 122 / 267 (GLEIF API, 2 Oct 2026). 13 verdicts (all yes) are saved in committed files, so a fresh clone shows the same confirmed matches.

## What works

- One-command start from a clean clone; upload with the company and current lists pre-filled; one upload changes one company only.
- Shares, High and Watch with thresholds changeable on screen; every number shows its base.
- GDACS refreshed on start and on request; if it is down, "Disaster data unavailable" and the rest works.
- Company network page: GLEIF candidates per company, Confirm / Reject / Undo, a graph to parent companies, conflicts flagged, verdicts kept.
- GLEIF API search for companies other than adidas and Nike: 1 request a second, cached, resumes after a restart.
- Map: clustered sites, flat or globe, Plain / Map / Satellite; a failing tile service gives Plain.
- Tests: 139 backend (pytest), 27 frontend (vitest).

## What we cut, and why

- **Alternative suppliers and product measures:** the data does not say what each site makes, and product words merge every contributor's words: 80 of adidas's 766 open sites have "NIKE" among theirs. Sites with product words: adidas 32.9%, Nike 78.4%, Apple 9.7%, Samsung 4.3%, Amazon 73.4%. "Home Goods" appears on 58.7% of Amazon's sites that have product words.
- **Region level:** Natural Earth's 1:50m states file covers 9 countries, not Vietnam; the 1:10m file is 40.7 MB as GeoJSON.
- **Site addresses in the panel:** no reverse geocoding. 147 of Amazon's 1,732 sites carry the "same coordinates" warning, and Nominatim's policy does not encourage bulk geocoding (at most 1 request a second).
- **Complete wildfire coverage:** NASA FIRMS needs a key; NASA EONET gives points only (all 200 open wildfire events, 3 Oct 2026).
- **The Contact entity:** personal data, and rare: 3 of Amazon's 1,732 open sites have a point of contact. The `claim_*` columns are dropped on load.
- **Supplier-to-supplier links, tier labels, performance trends:** not in the data. **Per-company login:** demo only.
- **The phone layout:** the later screens were checked at 1440 px only.

## Known limits

- Owner names are not merged by spelling: Nike's 3 "SHAHI" sites and adidas's 4 "SHAHI EXPORTS" sites are different owners.
- Lists are dated: Apple 2019, Samsung 2021, Nike February 2024, adidas January and April 2026, Amazon 2026.
- GDACS alerts are automatic, not reviewed. Drought DR1018332 has covered about 1.76 million km² since 21 Dec 2025; a site counts only if GDACS lists its country (2 Oct 2026: 54 UK sites inside it, listed but not counted).
- GDACS's list can skip wildfires when paging (30 Sep 2026: 24 repeated rows over 13 pages); the screen says how many may be missing.
- Plain's Natural Earth 1:50m coastlines are coarse close up; Satellite is 2016 imagery (EOX's 2018–2025 imagery is non-commercial).
- The GLEIF API search matches legal names only: groups named in another script are missed (LG DISPLAY, MURATA MANUFACTURING, TOKYO ELECTRON), a subsidiary can come first, and one-word names (DELTA, FLEX, MAS) inflate "possible". A new search takes about a second per owner name (Amazon: about 5 minutes). Parent names show as in GLEIF, in upper case.
- The app has no login, so its API is not a privacy boundary: /api/network/candidates without ?company= returns every company's candidates. In production, per-customer access needs authentication.

## How to run

Needs Docker with Compose.

```sh
git clone https://github.com/abhifourkites/geo-risk.ai.git
cd geo-risk.ai
docker compose up
```

- Open http://localhost:5173. The first start can take 1–2 minutes, plus the first image build (the 4 companies load, then the first GDACS refresh).
- To try the upload, use `data/demo/amazon.csv`.
- Data is kept in the named volume `pgdata`: `docker compose down` keeps it, `down -v` erases it.
- The internet is needed for GDACS, GLEIF API searches, and the Map and Satellite styles.
- Tests: `docker compose run --rm backend pytest`; `docker compose run --rm --no-deps frontend npm test`. After a code change: `docker compose up --build`.

## Data

- Open Supply Hub downloads in `data/demo`: `facilities.csv` 1,536 rows (adidas and Nike), `apple-osh.csv` 749, `samsung.csv` 187, `amazon.csv` 3,798: 6,270 rows (6,173 distinct sites), while the brief says a free account allows 5,000 locations a year. `[author: how the data was downloaded]`
- Licence: per Open Supply Hub's FAQ, "Creative Commons Sharealike 4.0"; the files are shared under it, with the personal `claim_*` columns removed (`data/demo/SOURCE.md`).
- GLEIF: a slice of the 29 Sep 2026 files, in `data/reference`. GDACS: live.

## Hours spent

`[author to fill]`
