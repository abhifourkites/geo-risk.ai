# Decision log

Each entry: what we chose, what we chose against and why not, what it cost, and what would change our mind. How each decision is implemented is in [`docs/RULES.md`](docs/RULES.md).

## 1. Outcome: Geographic Supplier Risk Intelligence

- **Chose:** Geographic Supplier Risk Intelligence: supplier concentration by country and owner, with live disaster areas on a map.
- **Against, and why not:**
  - *Tier 2 and Tier 3 Supplier Intelligence:* it promises signals "derived from actual transaction flows"; the data has no supplier-to-supplier links.
  - *Supplier Risk Intelligence:* it needs suppliers "scored continuously from live performance data"; there is none.
- **Cost:**
  - No upstream visibility and no supplier scoring.
  - Alternative suppliers are not built (#8).
- **Would change our mind:** Supplier-to-supplier links from transaction data, or per-supplier performance data.

## 2. Data slice: Open Supply Hub, five companies, GLEIF and GDACS

- **Chose:**
  - Open Supply Hub as the foundation, with five companies: adidas, Nike, Apple and Samsung (loaded on first start), and Amazon (an upload file).
  - GLEIF for parent companies: its files for adidas and Nike, its API for every other company at one request a second, because GLEIF documents a limit of 60 requests a minute per user.
  - GDACS for disasters, live.
- **Against, and why not:**
  - *GLEIF as the owner source:* only 3 of the file's 30 likely matches have a parent.
  - *GLEIF's fund links:* 46.4% of relationship rows are fund links, not company parents.
  - *One GDACS read of all six event types:* it missed 12 current events (30 Sep 2026).
- **Cost:**
  - Open Supply Hub allows 5,000 downloaded locations a year, and the lists are dated.
  - The API search matches legal names only, so groups named in another script are missed.
  - Some current wildfires can be missed, and a country GDACS leaves off an event's list is not counted.
- **Would change our mind:** The company's own supplier data, a production-site source without the cap, or a complete GDACS feed.

## 3. Storage engine: PostgreSQL + PostGIS

- **Chose:** PostgreSQL with PostGIS (for the inside-a-disaster-area check), in Docker Compose.
- **Against, and why not:**
  - *A graph database:* every question the screen asks is a few joins over 8 graph tables.
  - *Another relational store:* FourKites' geo-service schema already uses PostgreSQL (`pg_trgm`, `jsonb`).
- **Cost:**
  - It needs Docker.
  - Size and query time at 50× the demo (116,350 site rows) were not measured.
- **Would change our mind:** Evidence that FourKites' own services use a different store.

## 4. Graph model: 8 graph tables (14 in all), a hop is a join

- **Chose:**
  - 8 graph tables, plus `hazard_area_part` (for speed) and 5 GLEIF API tables.
  - A hop is a join; each company's rows are kept apart.
- **Against, and why not:**
  - *One site table keyed only by the Open Supply Hub ID:* a second upload would overwrite the first company's sites; 7 sites are on both Apple's and Samsung's lists.
  - *Verdicts as a column of `gleif_match`:* that table is rebuilt on every start and upload.
  - *A database per company:* more to run and back up, for no gain at demo size.
- **Cost:** A site on two companies' lists is stored twice; for the 7 shared sites, the needed columns are identical today.
- **Would change our mind:** An existing FourKites tenancy model that this data should follow.

## 5. Resolution: clean names, never merge, a person confirms GLEIF matches

- **Chose:**
  - Owner names are cleaned but different spellings are never merged.
  - GLEIF name matches stay candidates until a person confirms them, because GLEIF's API documentation says fuzzy matching "does not guarantee that the LEI belongs to the legal entity you are searching for". One written rule set rates them, for every company.
  - One verdict per name and LEI, because it is a fact about the GLEIF company. Each company sees only its own sites, so one customer never sees another's suppliers. The 13 verdicts are saved in committed files.
- **Against, and why not:**
  - *Confirming the API's first result automatically:* "Intel" returned INTEL INVEST (CY) first.
  - *Trusting name matches:* "FAR EASTERN" matched a Taiwanese bank.
  - *A generic-name rule:* at 5 same-name matches it misses MAS (3); at 3 it also demotes AVERY DENNISON CORPORATION, the parent of PT Paxar Indonesia.
- **Cost:**
  - One company can be split: Nike's "SHAHI" and adidas's "SHAHI EXPORTS" stay apart.
  - No parent shows until a person confirms.
  - "Possible" is broad: 201 of the file's 440 candidates (the file had 48).
- **Would change our mind:** A reliable company identifier across sources (for example a confirmed LEI), or a reviewed list of name variants.

## 6. Location level: country only

- **Chose:** Concentration by country. A Vietnam 2025 province mapping is prepared but not used.
- **Against, and why not:**
  - *Regions from the file:* no column names a region.
  - *Natural Earth's 1:50m states file:* it covers 9 countries, not Vietnam.
  - *Its 1:10m file:* 40.7 MB as GeoJSON.
- **Cost:** A country hides clusters: Vietnam holds 40.6% of Nike's workers, and Dong Nai alone 13.5%.
- **Would change our mind:** A region boundary file we may use, small enough to ship.

## 7. Risk levels: High 10%, Watch 5%

- **Chose:**
  - High at 10% in one country or under one owner, Watch at 5%; a site inside a current Orange or Red disaster is High, Green is Watch.
  - Share of estimated workers when known for at least 90% of open sites, otherwise of sites.
  - Thresholds changeable on screen; every number shows its base.
- **Against, and why not:**
  - *Site counts when workers are known:* Dong Nai has 5.4% of Nike's sites but 13.5% of its workers.
  - *A 10% cut only:* it would hide Feng Tay's 9.3% of Nike's workers.
  - *3%:* up to 10 owners, too many to act on.
- **Cost:**
  - The thresholds are our choice, and worker numbers are estimates.
  - On the site basis, a small site weighs the same as a large one.
  - Thin measures still show: Apple's owner measures rest on 66 of 749 sites.
- **Would change our mind:** A threshold the company's risk team already uses, or real production volumes per site.

## 8. What we left out

- **Chose:** Not to build alternative suppliers, product measures, single-source by material (owner dependency instead), supplier-to-supplier links, tier labels, performance trends or a per-company login. The evidence for each is in README "What we cut".
- **Against, and why not:** *Facility type as a stand-in for products:* 747 of 850 open adidas and Nike sites that have one say "Final Product Assembly".
- **Cost:** One of the outcome's four parts, a product view and a tier filter. Owner dependency is not the brief's single-source dependency, and ownership is not supply.
- **Would change our mind:** The company's own supplier data: what each site makes, and which site it supplies.

## 9. Frameworks, libraries and map styles

- **Chose:**
  - FastAPI (MIT) and React (MIT) with TypeScript (Apache-2.0), the brief's house stack; MapLibre GL JS (BSD-3-Clause) via react-map-gl (MIT), MUI (MIT) and @xyflow/react (MIT). Licences are from each package's metadata.
  - Plain map style by default, with no outside service.
  - OpenFreeMap and EOX's 2016 imagery (CC BY 4.0) as free Map and Satellite options.
- **Against, and why not:**
  - *Leaflet:* its projections are all flat, and the app has a globe view.
  - *Mapbox GL JS:* since version 2 it may be used only with a Mapbox account and products.
  - *Google map tiles:* billing and an API key are required, and its terms (3.2.3 (a), (e)) forbid scraping tiles and use "with or near a non-Google Map".
- **Cost:**
  - The map needs WebGL, and MUI and @xyflow/react are two more dependencies to keep up to date.
  - Satellite imagery is from 2016 (EOX's 2018–2025 imagery is non-commercial).
  - Map and Satellite depend on two free services with no service-level promise.
- **Would change our mind:** A map or component library the FourKites team already uses, or a map service it pays for.
