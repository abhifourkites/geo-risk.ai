# Rules

How the decisions in [DECISIONS.md](../DECISIONS.md) are implemented, one rule per line. The design is in [docs/architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md).

## Data and cleaning

- **Open site:** on the company's current list, and not closed.
- **Owner names (R4):** upper case, `&` → AND, punctuation and legal-form words such as LTD removed; letters of every script kept (dropping them would lose owners written only in Chinese); different spellings never merged; "NULL", N/A and NO GROUP are placeholders, not owners.
- **Self-named owner:** kept when it is the site's only owner, so a company can count as its own owner; always dropping it cut Apple's owner known to 21 of 749 sites, deleting groups such as INTEL.

## Measures and levels

- **Share basis:** estimated workers when known for at least 90% of the company's sites; otherwise site counts.
- **High:** 10% or more in one country or under one owner, or a site inside a current Orange or Red disaster area. **Watch:** 5% or more, or a site inside a current Green area.
- **Every number shows its base**, for example "owner known for 66 of 749 sites".

## GLEIF matching

- **Rating** (`backend/app/rating.py`): one written rule set for every company, likely / possible / unlikely; a sole proprietor, fund or lapsed registration is at most possible; the GLEIF file's own level is kept for reference only (two rule sets for one question, and the file's were not written down).
- **Per company:** each company sees only its own sites of a candidate, rated with its own site countries, and is not told which other companies share an owner.
- **One verdict per name and LEI:** a verdict on (kind, our names, LEI) applies to every company with that name and LEI; a verdict given on the page is used over a saved one, and Undo goes back to it.
- **Verdict storage:** `gleif_verdict` holds the verdicts given on the page; `gleif_match` is rebuilt on every start and after each verdict, and stores a conflict as `conflict`.
- **Conflicts:** on one site link, yes from one candidate and nothing from another confirms, no and nothing rejects, and yes and no is a conflict: not confirmed, no parent shown, marked "conflicting verdicts – needs review".
- **GLEIF parents:** company links only (direct, ultimate, international branch); for API candidates, fetched only after a confirm; every GLEIF API answer is cached.

## Disasters

- **GDACS read:** the event list is read once per event type (TC, FL, EQ, VO, DR, WF), each paged until a page has fewer than 100 events.
- **GDACS refetch:** an event's areas are fetched again only when its `episodeid` or `datemodified` changes (event records have no `datetime` field).
- **Disasters:** only GDACS's *affected* areas count. Forecast areas, uncertainty cones, distance circles and the flood "Global area" do not.
- **Earthquakes:** every intensity area counts, including "Intensity 0" (no cut-off).
- **Inside a disaster:** the site's point is in a current affected area and its country is in the event's `affectedcountries` list (an empty list: the area alone); a site left out is still listed in the panels.
- **Worked out when asked:** whether a site is inside a disaster is not stored; it is worked out on each request, using the areas cut into small pieces (`hazard_area_part`).
- **Disaster level:** from the event's alert level for every event type, not a cyclone's wind band (only cyclones have bands), so a site in the outer band of an Orange cyclone is High.

## Map

- **Map style switch:** only the base below the app's layers changes (replacing the whole style left them missing after each switch); a service that does not respond gives Plain with a one-line notice; on Map, the High and Watch fills dim the place names.
- **Map credits:** always shown in full (EOX: "clearly visible"). Satellite uses EOX's layer without a year (2016, CC BY 4.0); the 2017 layer is CC BY 4.0 in EOX's WMTS capabilities but not on its licence page, so it is not used.
