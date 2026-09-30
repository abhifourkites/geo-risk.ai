# Decision log

Each entry covers what we chose, what we chose against and why, what we gave up, and what would change our mind.

---

## 1. Outcome chosen: Geographic Supplier Risk Intelligence

- **Chose:** Geographic Supplier Risk Intelligence.
- **Against:**
  - *Tier 2 and Tier 3 Supplier Intelligence:* the brief promises signals "derived from actual transaction flows", and the data has no supplier-to-supplier links.
  - *Supplier Risk Intelligence:* it needs suppliers "scored continuously from live performance data", and there is no performance data.
- **Gave up:** Upstream (Tier 2 and 3) visibility and supplier scoring. Even the chosen outcome is only partly served: alternative supplier identification is not built (#8).
- **Would change our mind:** Supplier-to-supplier links from transaction data, or performance data per supplier, such as delivery records.

## 2. Data slice: Open Supply Hub, four demo customers, GLEIF and GDACS

- **Chose:**
  - **Open Supply Hub** as the foundation. It is the only source in the brief with production site locations.
  - **Four demo customers** whose lists are public on Open Supply Hub: adidas, Nike, Apple and Samsung.
  - **GLEIF** for parent companies. They come from the relationship file, read offline, using company links only: IS_DIRECTLY_CONSOLIDATED_BY, IS_ULTIMATELY_CONSOLIDATED_BY and IS_INTERNATIONAL_BRANCH_OF.
  - **GDACS** for hazards, live.
- **Against:**
  - *GLEIF as the owner source:* of 30 likely matches, only 3 have a parent. Several of our largest owners (Feng Tay, YKK, Hwaseung, Shoetown, Ramatex, Interloop) got no GLEIF match.
  - *GLEIF's live API for each company:* its rate limits were not checked. A one-time check on 2026-09-30 gave the same 3 parents as the file.
  - *GLEIF's fund links:* they are 227,252 of the 489,389 relationship rows (46.4%). They are fund managers, sub-funds and feeders, not company parents.
  - *FMCSA:* it covers carriers, which the brief's glossary separates from suppliers.
- **Gave up:**
  - Open Supply Hub allows 5,000 downloaded locations a year, and the lists are dated.
  - The GLEIF files are a snapshot (29 Sep 2026, 16:00), and they give no reason when a parent is missing.
  - Apple's and Samsung's names are not yet matched to GLEIF.
- **Would change our mind:**
  - The company's own supplier data.
  - Another source of production locations without the download cap.
  - GLEIF coverage for most matched companies.

### GDACS: one query per event type

- **Chose:** read GDACS's event list once per event type (TC, FL, EQ, VO, DR, WF). It is the documented call with one type in `eventlist`, and each type is paged until a page has fewer than 100 events. The refresh counts rows that repeat across pages, and the screen shows how many events may be missing.
- **Against:**
  - *One query for all six types* (the call in `docs/architecture/archive/ARCHITECTURE_detailed.md`, section 8): its pages are sorted only by end date, and many events share one, so events repeat across pages and others are on no page. On 30 Sep 2026 it returned 1,844 rows but 1,827 distinct events, and missed 12 current events: 11 wildfires, and the drought DR1015915 that holds Nike's site BR2019085Q71GZV.
  - *Shorter date windows* were tested and do not close the wildfire gap: on 30 Sep 2026, 29 of 31 one-day windows still returned a full page of 100 wildfires, so they still need paging. They also found 19 wildfires (2 current) that the 30-day list missed, which confirms the gap is real. (one-time browser check, 30 Sep 2026; not repeated by the script)
  - *Why the list repeats and skips events:* GDACS's own API specification (gdacsapi/swagger/v1/swagger.json) describes geteventlist/search as: "it returns the first 100 elements, it is possible to obtain record by paging specifying the page size and page number. The records are ordered by todate desc." This explains the repeated and skipped events.
  - *A larger pageSize* does not help: 500 and 2000 both returned exactly 100 rows.
  - *geteventlist/events4app:* at most 100 events, no droughts or volcanoes; missed FL1104122 and DR1015915.
  - *geteventlist/map:* a subset only (6 wildfires; the Istanbul flood FL1104183 missing).
  - *The gdacs-api Python package* (2.0.0, "Alpha", last released June 2022) uses events4app; its per-event GeoJSON file returned HTTP 403 for FL1104183; it calls GDACS without a timeout.
  - (The five points above: one-time browser check, 30 Sep 2026.)
- **Gave up:** Some current wildfires may be missing. On 30 Sep 2026 the wildfire list repeated 24 rows over 13 pages. The other five types repeated no rows, so none of their events was skipped.
- **Would change our mind:** A GDACS feed or query that returns every current event without paging.

### GDACS: change detection by episodeid + datemodified

- **Chose:** a refresh fetches an event's areas only when its `episodeid` or `datemodified` differs from the stored values (`hazards.py`, `refresh`).
- **Against:**
  - *Comparing `datetime`* (as `docs/architecture/archive/ARCHITECTURE_detailed.md`, section 8, says): GDACS event records have no `datetime` field. Their date fields are `fromdate`, `todate` and `datemodified`.
  - *Fetching every event's areas on each refresh:* on 30 Sep 2026, a refresh on an empty database fetched the areas of 251 events, and a refresh on a database that already held the events fetched 10.
- **Gave up:** If GDACS changes an event's areas without changing its episode or `datemodified`, the app keeps the old areas until one of them changes.
- **Would change our mind:** Evidence that GDACS changes areas without changing `datemodified`, or another change marker that GDACS documents.

### GDACS: every earthquake intensity area counts

- **Chose:** every earthquake intensity area (`Poly_SMPInt_N`, labelled "Intensity N", including "Intensity 0") counts as affected (`hazards.py`, `is_affected`), as the counting table (R8) lists it.
- **Against:** *Only areas above an intensity cut-off:* the counting table has none, so any cut-off would be our own choice.
- **Gave up:** Weak shaking counts the same as strong. Evidence (one-time browser check, 30 Sep 2026): on 4 current earthquakes, "Intensity 0" had the same width as "Intensity 4"; "Intensity 3" and "3.5" areas were up to 145 km wide.
- **Would change our mind:** A shaking level that the company's risk team treats as the lower limit. Weaker areas would then not count.

## 3. Storage engine: PostgreSQL + PostGIS

- **Chose:** PostgreSQL + PostGIS, run with Docker Compose.
  - FourKites' geo-service schema uses PostgreSQL: it has `enable_extension "plpgsql"`, `enable_extension "pg_trgm"` and `jsonb` columns.
  - PostGIS is our addition, for the map check (is a point inside a disaster area?).
- **Against:** *A separate graph database:* every question the screen asks is a few joins over 7 tables (#4).
- **Gave up:**
  - It needs Docker.
  - Database size and query time at 50× the demo (116,350 site rows) were not measured.
- **Would change our mind:** Evidence that FourKites' own services use a different store.

## 4. Graph model: 7 tables, a hop is a join

- **Chose:**
  - 7 tables: customer, site, site_owner, gleif_match, gleif_parent, hazard_event, hazard_area.
  - A hop is a join. The multi-hop questions are:
    - site → owner → that owner's other sites;
    - site → confirmed GLEIF entity → parent;
    - disaster event → its sites → their owners → those owners' other sites.
  - Each company's rows are kept apart. One upload changes one company only, and a site is stored once per company.
- **Against:**
  - *One shared site table keyed only by the Open Supply Hub ID:* a second company's upload would overwrite the first company's site data. 7 sites are on both Apple's and Samsung's lists.
  - *A separate database per company:* more to run and back up, for no gain at demo size.
- **Gave up:** A site on two companies' lists is stored twice. For the 7 shared sites, the needed columns are identical in both files today.
- **Would change our mind:** An existing FourKites tenancy model that this data should follow.

## 5. Resolution strategy: clean names, never merge, confirm GLEIF matches

- **Chose:**
  - **Owner names are cleaned:** upper case, `&` → AND, punctuation removed, and legal-form words such as LTD removed.
    - Letters of every script are kept.
    - Different spellings are never merged.
    - Conflicting reports are shown as conflicts.
  - **A self-named owner is kept when it is the site's only owner.**
  - **GLEIF name matches are candidates** until a person confirms them.
- **Against:**
  - *Merging similar names automatically.*
  - *Dropping non-Latin letters:* owners written only in Chinese would disappear, for example `三芳化學工業股份有限公司`.
  - *Always dropping a self-named owner:* it deleted real owner groups, such as INTEL (9 Apple sites) and HITACHI (9 Samsung sites). Owner known fell to 21 of 749 Apple sites and 8 of 187 Samsung sites.
  - *Never dropping it:* a site that lists itself next to its real parent would show a false conflict. Conflicts would rise from 189 to 207 for adidas, and from 232 to 257 for Nike.
  - *Trusting GLEIF name matches:* "FAR EASTERN" matched a Taiwanese bank and a securities firm, and "XING YE" matched a Hong Kong bank branch (`興業銀行股份有限公司香港分行`).
- **Gave up:**
  - One company can be split. Nike's 3 "SHAHI" sites are not linked to adidas's 4 "SHAHI EXPORTS" sites.
  - Names that differ only by accents also stay apart.
  - A company can count as its own owner.
  - No GLEIF parent is shown until a person confirms the match; 0 are confirmed today.
- **Would change our mind:** A reliable company identifier across sources (for example a confirmed LEI), or a reviewed list of name variants.

## 6. Location level: country only in the MVP

- **Chose:** Concentration by country, from `country_code`. Region level is not used. A Vietnam 2025 province mapping is in the repo: prepared, not used in the MVP.
- **Against:** *Region level:* no column in the file names a region, so it would need a boundary file.
- **Gave up:** A country hides clusters inside it.
  - Vietnam holds 31.5% of adidas's and 40.6% of Nike's estimated workers.
  - A region view would show Dong Nai, with 13.5% of Nike's workers.
  - With the same thresholds, every demo customer has 2 to 4 countries at High (adidas 3, Nike 3, Apple 2, Samsung 4).
- **Would change our mind:** A boundary file we may use.

## 7. Risk levels: High 10%, Watch 5%

- **Chose:**
  - **High:** 10% or more in one country or under one owner, OR a site inside a current Orange or Red disaster area.
  - **Watch:** 5% or more, OR a site inside a current Green area.
  - **Share basis:** estimated workers when they are known for at least 90% of the company's open sites; otherwise site counts. The screen shows which one is in use:
    - adidas: workers (719 of 766, 93.9%);
    - Nike: workers (625 of 625);
    - Apple: sites (workers known for 65 of 749);
    - Samsung: sites (workers known for 4 of 187).
  - **Every number shows its base**, and a measure appears only when its field is known.
- **Against:**
  - *Site counts when workers are known:* sites differ in size. Dong Nai has 5.4% of Nike's sites but 13.5% of its workers.
  - *Workers always:* Apple's and Samsung's shares would rest on 65 and 4 sites.
  - *A 10% cut only:* it flags no owner for adidas or Nike, so Feng Tay's 9.3% of Nike's workers would be hidden.
  - *3%:* up to 10 owners, too many to act on.
- **Gave up:**
  - The thresholds are our choice, not a standard.
  - Worker numbers are estimates, and 47 adidas sites have none.
  - On the site basis, a small site weighs the same as a large one.
  - Thin measures still appear: Apple's owner measures rest on 66 of 749 sites.
- **Would change our mind:** A threshold the company's risk team already uses, or real production volumes per site.

### Disaster level: from the event's alert level

- **Chose:** a site's disaster level comes from the event's alert level: Orange or Red is High, Green is Watch (`measures.py`, `HAZARD_LEVEL`). The same rule applies to every event type.
- **Against:** *The cyclone band colour* (`Poly_Green`, `Poly_Orange` and `Poly_Red`, labelled 60, 90 and 120 km/h): only cyclones have these bands. Flood, earthquake, wildfire, drought and volcano areas carry no colour, only their event's alert level.
- **Gave up:** A site in the outer 60 km/h band of an Orange cyclone is High.
- **Would change our mind:** A risk rule that rates cyclone sites by the wind band they are in.

## 8. What we left out

- **Chose not to build:**
  - **Alternative suppliers.**
  - **Single-source by material.** It is shown as owner dependency instead, labelled that way.
  - **Product grouping.** Product words are shown only as information, labelled "reported by any contributor".
  - **Supplier-to-supplier links.**
  - **Tier labels.** Each list's own name is shown instead:
    - adidas: Primary (438 sites), Licensee (194), Wet Process Suppliers (134) (each site counted once, by its first list; 3 sites are on two lists, so per list the counts are 438 / 195 / 136);
    - Nike: February 2024 Facility List;
    - Apple: Apple 2019 Facility List;
    - Samsung: Samsung 2021 Facility List.
  - **Near-real-time supplier lists.**
  - **Performance trends.**
  - **Per-company login.**
- **Why:** the data has no product, material, supplier-to-supplier or performance data. The lists are only as fresh as their publishers make them. The login is left out because this is a demo.
- **Against:**
  - *Facility type as a stand-in for products:* 747 of 850 open adidas and Nike sites that have one list "Final Product Assembly". Apple's and Samsung's files have no facility type.
  - *Product words from the download:* they merge every contributor's words.
  - *Mapping product words to standard product codes (HS):* we tested it, and a person would still need to check every code.
  - *A rough Nike-only version from Nike's broad categories:* nothing for adidas.
  - *Mapping lists to tiers ourselves.*
- **Gave up:**
  - One of the four parts of the outcome (alternative suppliers).
  - A product view, and a tier filter.
  - Owner dependency is not the brief's definition of single-source dependency, and ownership is not supply.
- **Would change our mind:**
  - The company's own supplier data: what each site makes, and which site it supplies.
  - The company's own tier definitions.
  - Supplier performance data.
  - A daily supplier feed.
