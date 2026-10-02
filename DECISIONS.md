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
  - **GLEIF's API** for the owner names of every other company (Apple, Samsung, any upload): see "GLEIF API: candidates for any company" below.
  - **GDACS** for hazards, live.
- **Against:**
  - *GLEIF as the owner source:* of 30 likely matches, only 3 have a parent. Several of our largest owners (Feng Tay, YKK, Hwaseung, Shoetown, Ramatex, Interloop) got no GLEIF match.
  - *GLEIF's live API for adidas and Nike too:* they keep the slice file's 440 candidates and its verdicts, so nothing about them changes. A one-time check on 2026-09-30 gave the same 3 parents as the file.
  - *GLEIF's fund links:* they are 227,252 of the 489,389 relationship rows (46.4%). They are fund managers, sub-funds and feeders, not company parents.
  - *FMCSA:* it covers carriers, which the brief's glossary separates from suppliers.
  - *Loading every contributor in an uploaded file as a company:* the upload page fills in one company, and a person checks it and clicks "Load this company". Anonymous types ("A Brand / Retailer") and "(Claimed)" entries are not a company's lists. A download made for one company is also partial for every other contributor in it: all 3,798 rows of an Amazon download (2 Oct 2026, not in the repo) name Amazon.com, Inc., so Target's 233 sites in it (its February 2026 list) are all shared with Amazon.
- **Gave up:**
  - Open Supply Hub allows 5,000 downloaded locations a year, and the lists are dated.
  - The GLEIF files are a snapshot (29 Sep 2026, 16:00), and they give no reason when a parent is missing.
  - Other companies' candidates come only from GLEIF's legal-name search, which misses groups whose GLEIF legal name is written in another script (see below).
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

### GDACS: a site counts only in a country the event lists as affected

- **Chose:** a site counts as inside a current event only if its point is inside an affected area **and** its country is in that event's `affectedcountries` list (ISO2, from the event list, stored with each event). An event with an empty list uses the area alone. A site left out this way is still shown: in the disaster panel, under "Inside the area, but GDACS does not list <country> as affected", and in its site panel.
- **Evidence (live GDACS, 2 Oct 2026):** drought DR1018332 (Orange, current, episode 24, current since 21 Dec 2025) lists 29 affected countries, not GB, but its affected area (`Poly_area`) holds 47 of Amazon's UK sites, for example GB2022297018WT0, Montgomery Waters Ltd. (52.537, -3.064). The other 33 Amazon sites inside it are in listed countries (DE, AT, IT, FR, ES, HU, CZ, IE, SK). With the rule, the site–event pairs inside current events went from Amazon 83 → 36, adidas 27 → 22, Apple 16 → 15, Nike 4 → 3 and Samsung 3 → 3; every site removed was a UK site in DR1018332 (54 in all), and no site in a listed country was removed. 23 of the 228 current events had an empty list.
- **Against:**
  - *The area alone:* the drought's area crosses into the United Kingdom, so it counted 54 UK sites in an event that GDACS itself does not say affects the UK.
  - *Leaving out events with no list:* those 23 events would never count.
- **Gave up:** If GDACS leaves a really affected country off an event's list, that country's sites are not counted (they are still listed in the panels). A site with no country is not counted for an event that has a list.
- **Would change our mind:** Evidence that GDACS's lists leave out countries its areas really affect, or finer drought areas.

### GLEIF API: candidates for any company

- **Chose:** for every company except adidas and Nike, one search of GLEIF's API per distinct owner name (owners only), automatically after "Load this company", or with "Find GLEIF candidates" on the Company network page (`gleif_api.py`). It runs in the background, with progress shown, and the app stays usable.
  - `GET https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=<core name>&page[size]=15`; at most 10 results kept per name, most likely first.
  - The core name is the owner name without commas and without R4's legal-form words, plus PTE (not an R4 word): "BRANDIX ASIA" found BRANDIX ASIA HOLDINGS PTE. LIMITED (SG); the name with "PTE LTD" found nothing. R4 itself is unchanged.
  - **At most 1 request a second**, with the app named in the User-Agent; network errors, 5xx and 429 are retried after 2 s and 5 s (the GDACS helper). **Every answer is cached in the database** (`gleif_api_cache`), so a name or a parent is never fetched twice, and a stopped search resumes where it stopped.
  - **Parents** (`/lei-records/{LEI}/direct-parent` and `/ultimate-parent`) are fetched only when a person confirms a match, and cached.
  - **Nothing is confirmed automatically.**
- **Facts (GLEIF's API documentation, and live tests on 2 Oct 2026):**
  - "Rate limiting is currently set at 60 requests, per minute, per user." GLEIF sends no rate-limit headers, so the app keeps the pace itself.
  - "There is no charge for the use of GLEIF's LEI data."
  - `filter[entity.legalName]=X` means "contains X", not exact: "Intel" returned "INTEL INVEST" (CY) first.
  - A comma means OR: "YKK TAIWAN CO., LTD." returned unrelated companies (TRANSLINK (LTD) LTD). A comma is never sent.
  - Fuzzy matching "does not guarantee that the LEI belongs to the legal entity you are searching for", so a person's review stays.
- **Live run (2 Oct 2026):**

  | Company | Owner names | Requests sent | Time | Names with a result | Candidates: likely / possible / unlikely |
  |---|---|---|---|---|---|
  | Apple | 41 | 41 | 45 s | 34 | 4 / 41 / 158 |
  | Samsung | 102 | 90 (12 cached) | 103 s | 57 | 8 / 49 / 235 |
  | Amazon | 273 | 266 (7 cached) | 308 s | 124 | 50 / 91 / 279 |

  No request failed or was answered 429. Each company's 10 largest owners, by their first candidate (our reading of the names and countries, not a check of company records):
  - Apple: the group found for 5 (INTEL, MICRON TECHNOLOGY, HENKEL, CATCHER TECHNOLOGY, INFINEON); a subsidiary first for 2 (WISTRON: Wistron Hong Kong; PEGATRON: PEGATRON Czech); a same-name company in another country first for 1 (FLEX: "Flex", BE); not found for 2 (LG DISPLAY, QUALCOMM TECHNOLOGIES). We had expected about 5 right, 2 subsidiary-first and 3 not found.
  - Samsung: the group found for 2 (THE DOW CHEMICAL, ENTEGRIS); a subsidiary first for 4 (HITACHI: HITACHI AMERICA; SAMSUNG ELECTRO MECHANICS: an Indian software unit; ELENTEC: ELENTEC INDIA; TDK: TDK HOLDING, FR); not found for 4 (TAIYO YUDEN, MURATA MANUFACTURING, TAIYO NIPPON SANSO, TOKYO ELECTRON).
  - Amazon: the group found for 3 (AVERY DENNISON, BRANDIX ASIA, CONSERVE ITALIA); a subsidiary first for 1 (LDH LA DORIA: LDH (LA DORIA) LIMITED, GB); another company first for 2 (GS MARKETING: GS PACIFIC MARKETING, AU; OMEGA PHARMA: OMEGA PHARMA, IN); not found for 4 (GREAT GIANT FIBRE GARMENT, YKK TAIWAN, EPIC GARMENTS DWC, INTERLOOP).
- **Against:**
  - *Trusting the first result:* "Intel" returned INTEL INVEST (CY) first.
  - *Sending the full name:* a comma makes it an OR search, and legal-form words such as PTE LTD make "contains" find nothing.
  - *More than 1 request a second:* GLEIF allows 60 a minute.
- **Gave up:**
  - **Cost: no fee, but the internet is needed** for every new search (cached answers do not need it). Time: about one second per owner name not searched before (Amazon: about 5 minutes).
  - Only the legal name is searched. Groups whose GLEIF legal name is in another script (for example Japanese and Korean companies) are not found by their English name, and a subsidiary with an English legal name can come first.
  - A short or common name matches many records, and only the first 15 are read.
- **Would change our mind:** A GLEIF search that also matches other and transliterated names, or a higher rate limit.

## 3. Storage engine: PostgreSQL + PostGIS

- **Chose:** PostgreSQL + PostGIS, run with Docker Compose.
  - FourKites' geo-service schema uses PostgreSQL: it has `enable_extension "plpgsql"`, `enable_extension "pg_trgm"` and `jsonb` columns.
  - PostGIS is our addition, for the map check (is a point inside a disaster area?).
- **Against:** *A separate graph database:* every question the screen asks is a few joins over 8 tables (#4).
- **Gave up:**
  - It needs Docker.
  - Database size and query time at 50× the demo (116,350 site rows) were not measured.
- **Would change our mind:** Evidence that FourKites' own services use a different store.

## 4. Graph model: 8 tables, a hop is a join

- **Chose:**
  - 8 tables: customer, site, site_owner, gleif_match, gleif_parent, gleif_verdict, hazard_event, hazard_area. Five more hold the GLEIF API search (`gleif_api_cache`, `_job`, `_name`, `_candidate`, `_parent`); they are not part of the graph.
  - **Verdicts in their own table, `gleif_verdict`**, keyed by the GLEIF slice file's candidate (kind, our names, LEI). One verdict answers "is this name that company?" for every company and site the candidate links to. Like every table, it is created on start only if it does not exist, so adding it needed no database reset.
  - A hop is a join. The multi-hop questions are:
    - site → owner → that owner's other sites;
    - site → confirmed GLEIF entity → parent;
    - disaster event → its sites → their owners → those owners' other sites.
  - Each company's rows are kept apart. One upload changes one company only, and a site is stored once per company.
- **Against:**
  - *One shared site table keyed only by the Open Supply Hub ID:* a second company's upload would overwrite the first company's site data. 7 sites are on both Apple's and Samsung's lists.
  - *A separate database per company:* more to run and back up, for no gain at demo size.
  - *Verdicts as a column of `gleif_match`:* that table is rebuilt from the slice file on every start and every upload, so the verdicts would be lost.
- **Gave up:** A site on two companies' lists is stored twice. For the 7 shared sites, the needed columns are identical in both files today.
- **Would change our mind:** An existing FourKites tenancy model that this data should follow.

## 5. Resolution strategy: clean names, never merge, confirm GLEIF matches

- **Chose:**
  - **Owner names are cleaned:** upper case, `&` → AND, punctuation removed, and legal-form words such as LTD removed.
    - Letters of every script are kept.
    - Different spellings are never merged.
    - Conflicting reports are shown as conflicts.
  - **A self-named owner is kept when it is the site's only owner.**
  - **"NULL" (any case) is a placeholder, like NO GROUP (..), N/A and NA:** data/demo/facilities.csv has "null" as an owner value 6 times, and counting it made a fake owner "NULL" (4 adidas sites, 2 Nike sites).
  - **GLEIF name matches are candidates** until a person confirms them, on the Company network page (Confirm / Reject / Undo), not only by editing the CSV: "an interface that only its author can operate has failed" (brief 3.3).
  - **GLEIF API candidates are rated with written rules** (`gleif_api.rate`; names compared after R4 cleaning; the country is GLEIF's legal-address country):
    - likely: the GLEIF legal name equals our owner name, its country is one of the owner's site countries, and the entity is ACTIVE;
    - possible: an equal name in another country, or the GLEIF name starts with our name, as whole words, in one of the owner's site countries (subsidiaries such as "HITACHI AMERICA" or "Avery Dennison België");
    - unlikely: everything else.
    - Flags: not active, registration lapsed, fund (FUND), sole proprietor (SOLE_PROPRIETOR).
    - Each company sees a shared candidate (the same owner name and LEI, one verdict) rated with its own site countries.
  - **The same rules, applied read-only to the slice file's 440 candidates, agree on 270** (the file's levels are not changed): of the file's 30 likely, 21 are likely by the rules (2 possible, 7 unlikely); of its 48 possible, 20 (16 likely, 12 unlikely); of its 362 unlikely, 229 (3 likely, 130 possible). The main differences: 130 generic names with an equal name in another country (for example MAS in BE and FR) are unlikely in the file but possible by the rules; 16 names become equal once R4 removes words such as PRIVATE LIMITED (SHAHI EXPORTS); 7 site names that the file matched on GLEIF's other or transliterated names are unlikely by the legal name alone.
  - **A site linked to one LEI by two candidates:** yes from one and nothing from the other confirms the link; no from one and nothing from the other rejects it; **yes from one and no from the other is a conflict**: the link is not confirmed (no parent shown), and the Company network list marks both candidates "conflicting verdicts – needs review", each naming the other. 47 links of adidas and Nike sites are reached by two candidates, for example one site's two owner names FAR EASTERN and FAR EASTERN NEW CENTURY (LEI 25490051NUU24RRHW523, which has a GLEIF parent). The slice file also has one question twice: VERTICAL KNITS with LEI 4469000001E9305R6057 (an exact match on another name, and a starts-with match on the legal name); both rows share one verdict.
  - **13 rows of the slice file reach one more site than its `our_sites` column says** (FAR EASTERN 8 → 9 on 10 rows, POU CHEN 13 → 14, UNIVERSAL APPAREL 1 → 2 on 2 rows): the file's counts used the older owner rule that dropped every self-named owner; the current rule keeps a sole self-named owner, so each name reaches one more site (CN2019093WZSXE8 "FAR EASTERN", TW202206598XFKC "Pou Chen Corporation", TH2019098FKBF6V "Universal Apparel Co.,Ltd"). The page shows the sites the app links.
- **Against:**
  - *Merging similar names automatically.*
  - *Dropping non-Latin letters:* owners written only in Chinese would disappear, for example `三芳化學工業股份有限公司`.
  - *Always dropping a self-named owner:* it deleted real owner groups, such as INTEL (9 Apple sites) and HITACHI (9 Samsung sites). Owner known fell to 21 of 749 Apple sites and 8 of 187 Samsung sites.
  - *Never dropping it:* a site that lists itself next to its real parent would show a false conflict. Conflicts would rise from 187 to 204 for adidas, and from 231 to 256 for Nike.
  - *Taking only the most likely candidate's verdict for a site and LEI (as the CSV-only build did):* a confirm on one candidate could be hidden by an undecided candidate for the same site, so a confirmed match would not show its parent.
  - *Letting yes win over no on one link:* two people who disagree would see a parent that neither has settled.
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
