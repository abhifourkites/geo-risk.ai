# Decision log

One entry per decision: what we chose, what we chose against and why not, what it cost, and what would change our mind.

## 1. Outcome: Geographic Supplier Risk Intelligence

- **Chose:** Geographic Supplier Risk Intelligence: where a company's supplier sites are concentrated, by country and by owner, with live disaster areas on a map.
- **Against, and why not:**
  - *Tier 2 and Tier 3 Supplier Intelligence:* it promises signals "derived from actual transaction flows", and the data has no supplier-to-supplier links.
  - *Supplier Risk Intelligence:* it needs suppliers "scored continuously from live performance data", and there is no performance data.
- **Cost:** No upstream visibility and no supplier scoring. Even this outcome is only partly served: alternative suppliers are not built (#8).
- **Would change our mind:** Supplier-to-supplier links from transaction data, or performance data per supplier, such as delivery records.

## 2. Data slice: Open Supply Hub, five companies, GLEIF and GDACS

- **Chose:**
  - **Open Supply Hub** as the foundation: the only source in the brief with production-site locations.
  - **Five companies** with public lists: adidas, Nike, Apple and Samsung (loaded on first start), and Amazon (an upload file, `data/demo/amazon.csv`, not loaded on start).
  - **GLEIF** for parent companies: the relationship file (29 Sep 2026), read offline, company links only. For companies other than adidas and Nike, GLEIF's API: one search per owner name, at most 1 request a second, every answer cached, nothing confirmed automatically.
  - **GDACS** for disasters, live:
    - the event list is read once per event type, because one read of all six types repeats and skips events (on 30 Sep 2026 it missed 12 current events);
    - an event's areas are fetched again only when its `episodeid` or `datemodified` changes;
    - every earthquake intensity area counts, as the counting table lists it;
    - a site counts only if its country is in the event's `affectedcountries` list (an empty list: the area alone).
- **Against, and why not:**
  - *GLEIF as the owner source:* of 30 likely matches in the file, only 3 have a parent.
  - *GLEIF's fund links:* 46.4% of relationship rows, and they are fund managers and feeders, not company parents.
  - *FMCSA:* carriers, which the brief's glossary separates from suppliers.
  - *The API's first result as the match:* "Intel" returned INTEL INVEST (CY) first.
- **Cost:** Open Supply Hub allows 5,000 downloaded locations a year, and the lists are dated. The API search matches legal names only, so it misses groups whose legal name is in another script. Some current wildfires can still be missed. If GDACS leaves a really affected country off its list, that country's sites are not counted (the panels still list them).
- **Would change our mind:** The company's own supplier data; a production-site source without the cap; GLEIF parents for most matched companies; a GDACS feed with every current event and no paging.

## 3. Storage engine: PostgreSQL + PostGIS

- **Chose:** PostgreSQL with PostGIS, run with Docker Compose. FourKites' geo-service schema already uses PostgreSQL (`pg_trgm`, `jsonb`). PostGIS answers "is this site inside a disaster area?".
- **Against, and why not:** *A graph database:* every question the screen asks is a few joins over 8 graph tables (#4).
- **Cost:** It needs Docker. Database size and query time at 50× the demo (116,350 site rows) were not measured.
- **Would change our mind:** Evidence that FourKites' own services use a different store.

## 4. Graph model: 8 graph tables (14 in all), a hop is a join

- **Chose:**
  - 8 graph tables (customer, site, site_owner, gleif_match, gleif_parent, gleif_verdict, hazard_event, hazard_area), plus `hazard_area_part` (disaster areas cut into small pieces, for speed) and 5 GLEIF API tables: 14 in all.
  - A hop is a join: site → owner → that owner's other sites; site → confirmed GLEIF company → parent; disaster → its sites → their owners → those owners' other sites.
  - Each company's rows are kept apart: one upload changes one company only.
  - Verdicts have their own table, keyed by (kind, our names, LEI).
- **Against, and why not:**
  - *One site table keyed only by the Open Supply Hub ID:* a second company's upload would overwrite the first company's site data. 7 sites are on both Apple's and Samsung's lists.
  - *A database per company:* more to run and back up, for no gain at demo size.
  - *Verdicts as a column of `gleif_match`:* that table is rebuilt on every start and upload, so verdicts would be lost.
- **Cost:** A site on two companies' lists is stored twice. For the 7 shared sites, the needed columns are identical today.
- **Would change our mind:** An existing FourKites tenancy model that this data should follow.

## 5. Resolution: clean names, never merge, a person confirms GLEIF matches

- **Chose:**
  - **Owner names are cleaned:** upper case, `&` → AND, punctuation and legal-form words such as LTD removed. Letters of every script are kept. Different spellings are never merged, and conflicting reports are shown as conflicts. A self-named owner is kept when it is the site's only owner. "NULL", N/A and NO GROUP are placeholders, not owners.
  - **GLEIF name matches are candidates** until a person confirms them on the Company network page. One set of written rules rates every candidate likely, possible or unlikely, for every company, using that company's own site countries. A sole proprietor, fund or lapsed registration is at most possible. The GLEIF file's own level is kept for reference.
  - **One verdict per name and LEI**, applied to every company with that name and LEI, because it is a fact about the GLEIF company. Each company sees only its own sites, and is not told which other companies share an owner. Yes and no on one site link is a conflict, and is not confirmed. The 13 verdicts given are saved in committed files, so a fresh clone shows the same matches.
- **Against, and why not:**
  - *Trusting GLEIF name matches:* "FAR EASTERN" matched a Taiwanese bank and a securities firm.
  - *Dropping non-Latin letters:* owners written only in Chinese would disappear.
  - *Always dropping a self-named owner:* owner known fell to 21 of 749 Apple sites, deleting real groups such as INTEL.
  - *A "generic name" rule:* at 5 or more same-name matches abroad it misses MAS (3); at 3 it also demotes AVERY DENNISON CORPORATION, which GLEIF records as the parent of PT Paxar Indonesia.
  - *Keeping the file's own levels for adidas and Nike:* two rule sets for one question, and the file's rules were not written down.
- **Cost:** One company can be split: Nike's 3 "SHAHI" sites are not linked to adidas's 4 "SHAHI EXPORTS" sites. A company can count as its own owner. No parent shows until a person confirms. "Possible" is broad: 201 of the file's 440 candidates, against the file's 48.
- **Would change our mind:** A reliable company identifier across sources (for example a confirmed LEI), or a reviewed list of name variants.

## 6. Location level: country only

- **Chose:** Concentration by country, from `country_code`. A Vietnam 2025 province mapping is in the repo, prepared but not used.
- **Against, and why not:** *Region level:* no column in the file names a region, so it needs a boundary file. Natural Earth's 1:50m states file covers 9 countries, not Vietnam; the 1:10m file is 40.7 MB as GeoJSON.
- **Cost:** A country hides clusters inside it. Vietnam holds 40.6% of Nike's estimated workers; a region view would show Dong Nai, with 13.5%.
- **Would change our mind:** A region boundary file we may use, small enough to ship.

## 7. Risk levels: High 10%, Watch 5%

- **Chose:**
  - **High:** 10% or more in one country or under one owner, or a site inside a current Orange or Red disaster area. **Watch:** 5% or more, or a site inside a current Green area. Both thresholds can be changed on screen.
  - **Disaster level** comes from the event's alert level, for every event type.
  - **Share basis:** estimated workers when they are known for at least 90% of open sites (adidas, Nike); otherwise site counts (Apple, Samsung, Amazon). Every number shows its base.
- **Against, and why not:**
  - *Site counts when workers are known:* sites differ in size. Dong Nai has 5.4% of Nike's sites but 13.5% of its workers.
  - *A 10% cut only:* no owner is flagged for adidas or Nike, so Feng Tay's 9.3% of Nike's workers would be hidden.
  - *3%:* up to 10 owners, too many to act on.
  - *A cyclone's wind-band colour:* only cyclones have bands.
- **Cost:** The thresholds are our choice, not a standard, and worker numbers are estimates. On the site basis a small site weighs the same as a large one. Thin measures still show: Apple's owner measures rest on 66 of 749 sites. A site in the outer band of an Orange cyclone is High.
- **Would change our mind:** A threshold the company's risk team already uses, or real production volumes per site.

## 8. What we left out

- **Chose not to build:** alternative suppliers; single-source by material (shown as owner dependency, labelled so); product grouping (product words shown only as information); supplier-to-supplier links; tier labels (each list's own name is shown); near-real-time supplier lists; performance trends; per-company login.
- **Against, and why not:**
  - *Facility type as a stand-in for products:* 747 of 850 open adidas and Nike sites that have one say "Final Product Assembly".
  - *Product words from the download:* they merge every contributor's words; 80 of adidas's 766 open sites have "NIKE" among them.
  - *Mapping product words to HS codes:* tested; a person would still need to check every code.
  - *Mapping lists to tiers ourselves:* adidas's and Nike's lists do not define tiers, and Apple's and Samsung's list names do not mention them, so we would be guessing.
- **Cost:** One of the four parts of the outcome (alternative suppliers), a product view and a tier filter. Owner dependency is not the brief's single-source dependency, and ownership is not supply.
- **Would change our mind:** The company's own supplier data (what each site makes, and which site it supplies), its tier definitions, supplier performance data, or a daily supplier feed.

## 9. Map styles: Plain by default; Map and Satellite from free services

- **Chose:**
  - A switch between Plain (the committed Natural Earth outlines, no outside service, the default), Map (OpenFreeMap's liberty style: free, no key) and Satellite (EOX Sentinel-2 cloudless, the 2016 layer).
  - Only the base is swapped, below the app's layers, so they never leave the map.
  - A service that does not respond gives Plain again, with a one-line notice.
  - The attributions are always shown in full: EOX requires its credit to be "clearly visible".
- **Against, and why not:**
  - *Google map tiles:* an API key and billing are required, and Google's terms forbid scraping tiles (3.2.3 (a)) and use "with or near a non-Google Map" (3.2.3 (e)).
  - *EOX's 2018 to 2025 imagery:* non-commercial use only (CC BY-NC-SA 4.0). The 2016 layer is CC BY 4.0.
  - *EOX's 2017 layer:* CC BY 4.0 in the WMTS capabilities, but not on EOX's licence page.
  - *Replacing the whole style on a switch:* the app's layers were missing for 0.5–1.3 s on every switch (3 Oct 2026).
- **Cost:** The satellite imagery is from 2016. Map and Satellite need the internet, and two free services with no service-level promise. On Map, the High and Watch fills dim the place names.
- **Would change our mind:** A commercial EOX licence (newer imagery), or a map service FourKites already pays for.

## 10. Frameworks and libraries

- **Chose:**
  - FastAPI (MIT) and React (MIT) with TypeScript (Apache-2.0): the brief's house stack.
  - MapLibre GL JS (BSD-3-Clause), through react-map-gl (MIT), for the map: flat and globe views, with disaster areas and clustered sites drawn from GeoJSON.
  - MUI (MIT) for the screen's components.
  - @xyflow/react (MIT) for the Company network graph.

  The licences are those in each installed package's metadata.
- **Against, and why not:**
  - *Leaflet:* its projections are all flat, and the app has a globe view.
  - *Mapbox GL JS:* since version 2, its licence allows use only "with the relevant Mapbox product(s)" by developers "with a current active Mapbox account".
- **Cost:** The map needs WebGL. MUI and @xyflow/react are two more dependencies to keep up to date.
- **Would change our mind:** A map or component library the FourKites team already uses.
