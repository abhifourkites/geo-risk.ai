# Architecture: Geographic Supplier Risk Intelligence (MVP)

## 1. Overview: what is it?

A company uploads its Open Supply Hub supplier list and sees, on a map, where its suppliers are concentrated, which owner companies hold many of its sites, and which sites sit inside a current disaster area. It is for the company's own procurement and risk team and the CPO; what it does is in the [README](../../README.md) and the [product guide](../walkthrough/index.html), and how each decision is implemented is in [docs/RULES.md](../RULES.md).

## 2. Data flow: where does data come from and go?

Dashed boxes are components that would exist at 50× the size but are not built (section 5).

```mermaid
flowchart LR
  gleif[("GLEIF<br/>(files offline, API live)")] --> match["Match names and<br/>find parent companies<br/>(Python)"]
  osh[("Open Supply Hub file<br/>(uploaded)")] --> load["Load and clean<br/>(Python)"]
  gdacs[["GDACS<br/>(live)"]] --> refresh["Hazard refresh<br/>(Python)"]
  match --> db[("PostgreSQL + PostGIS")]
  load --> db
  refresh --> db
  queue["Job queue for uploads<br/>and hazard refresh<br/>(not built)"]:::nb
  load -.-> queue
  refresh -.-> queue
  queue -.-> db
  db --> api["FastAPI"]
  review["GLEIF review queue,<br/>biggest share first<br/>(not built)"]:::nb
  db -.-> review
  review -.-> api
  precalc["Pre-calculated<br/>company results<br/>(not built)"]:::nb
  db -.-> precalc
  precalc -.-> api
  api --> ui["React screen:<br/>map, summary sentence,<br/>panels, Company network"]
  clusters["Server-side clustering<br/>or vector tiles<br/>(not built)"]:::nb
  api -.-> clusters
  clusters -.-> ui
  tiles[["Map tiles (OpenFreeMap, EOX),<br/>Map and Satellite styles only"]] -.-> ui
  classDef nb stroke-dasharray: 6 4
```

- **Load and clean** keeps the needed columns, drops the personal `claim_*` columns, cleans owner names without merging spellings, and works out estimated workers and warnings. One upload changes one company only.
- **Match names:** owner and site names are matched to GLEIF (the GLEIF file for adidas and Nike, GLEIF's API for every other company). A match is used only after a person confirms it on the Company network page; parents come from GLEIF's relationship records.
- **Hazard refresh** reads GDACS's current events once per event type, on every start and on request, and keeps only each event's *affected* areas.

## 3. Storage model: how is the graph modelled?

The 8 graph tables, with their keys and main fields:

```mermaid
erDiagram
  customer ||--o{ site : "has"
  site ||--o{ site_owner : "owned by"
  site ||--o{ gleif_match : "matched to"
  gleif_verdict }o--o{ gleif_match : "applied when candidates are linked"
  gleif_match }o--o{ gleif_parent : "parent of the matched company"
  hazard_event ||--o{ hazard_area : "has"
  site }o--o{ hazard_area : "inside (worked out when asked)"

  customer {
    text customer_id PK
    text name
  }
  site {
    text customer_id PK, FK
    text os_id PK "Open Supply Hub ID"
    text country_code
    geometry location
    numeric workers_est
  }
  site_owner {
    text customer_id PK, FK
    text os_id PK, FK
    text owner_name PK
  }
  gleif_match {
    text customer_id PK, FK
    text os_id PK, FK
    text lei PK "GLEIF company ID"
    text review_level "likely, possible, unlikely"
    text person_verdict "yes, no, conflict or empty"
  }
  gleif_verdict {
    text kind PK "owner or site"
    text our_names PK
    text lei PK
    text verdict "yes or no"
  }
  gleif_parent {
    text lei PK
    text type PK "direct, top or branch"
    text parent_lei
    text parent_name
  }
  hazard_event {
    text event_id PK
    text alert_level "Green, Orange, Red"
    bool is_current
    text_array affected_countries "ISO2, from GDACS"
  }
  hazard_area {
    bigint id
    text event_id FK
    geometry area "affected area only"
  }
```

Also: hazard_area_part (speed), and gleif_api_cache, gleif_api_job, gleif_api_name, gleif_api_candidate, gleif_api_parent (the GLEIF API search) – 14 tables in all.

- A hop is a join, and each company's rows are keyed by `customer_id`, so a site on two companies' lists is stored twice.
- Every table is created only if it is missing, so a start never resets data.

## 4. Query path: a multi-hop question

Example: *"Where is my supply concentrated?"* (the main question)

```mermaid
sequenceDiagram
  actor U as Analyst
  participant UI as React
  participant API as FastAPI (Python)
  participant DB as PostgreSQL + PostGIS
  U->>UI: picks a company, e.g. adidas
  UI->>API: GET /api/customers/adidas/view?high=10&watch=5
  API->>DB: SQL: count open sites, workers known, owner known
  DB->>API: counts
  Note over API: Python: share basis = workers if known for ≥ 90% of open sites, else sites
  API->>DB: SQL: sites and worker totals per country and per owner
  DB->>API: totals
  Note over API: Python: share per country and per owner, High at 10%, Watch at 5%
  API->>DB: PostGIS: which sites are inside a current disaster area
  DB->>API: sites inside, with alert levels
  API->>DB: SQL: every site with its location and owners
  DB->>API: sites
  Note over API: Python: the one-sentence summary
  API->>UI: sentence, coverage, countries, owners, disasters, sites
  UI->>U: the sentence, the cards and the map shading
```

Example: *"I clicked an owner. Where are its other sites?"*

```mermaid
sequenceDiagram
  actor U as Analyst
  participant UI as React
  participant API as FastAPI
  participant DB as PostgreSQL
  U->>UI: clicks an owner, e.g. POU CHEN
  UI->>API: GET /api/customers/adidas/owners/POU CHEN
  API->>DB: company -> its sites -> owner -> that owner's other sites
  DB-->>API: its sites and countries, and whether they are all in one country
  API-->>UI: owner panel + sites highlighted on the map
```

| The user asks | The app follows |
|---|---|
| "Where is my supply concentrated?" | company → sites → share per country → High / Watch, and a one-sentence summary |
| "What about this site?" | site → owners, warnings, disaster status, and its parent company if a person has confirmed the GLEIF match |
| "Which sites does this disaster hit?" | event → its sites → their owners → those owners' other sites |

## 5. At 50× the size: what breaks first, and how we would know

At FourKites, customers would upload their own supplier data, so this is about the system, not about where the demo data came from. At 50× (116,350 site rows instead of 2,327), in the order things break (the dashed boxes in section 2):

1. **Work done on every page load.** Today each company view recalculates every measure and sends every site and current disaster area. Fix: calculate once when the data changes, store the results (*pre-calculated company results*), and send the map as *server-side clusters or vector tiles*; clustering is browser-only today.
2. **Work done inside a request.** An upload, and a refresh someone asks for, run while the user waits. Fix: a *job queue* with progress, as the GLEIF API search already runs in the background.
3. **Outside services.** GLEIF, GDACS and the map tiles have limits and outages, and become the bottleneck as calls grow. Fix: bulk files instead of many small calls (GLEIF publishes its full data as files, already used for adidas and Nike), caching, retries and background fetching.
4. **Work that needs a person.** Confirming matches grows with the data: GLEIF review from 440 file candidates to about 22,000. Fix: a *review queue* ordered by share of supply.
5. **The database.** Indexes, and partitioning per customer; measure first.

**How we would know before a customer does:** a load test with 50× synthetic data before release (time and size per endpoint); monitoring of response time, response size, job-queue length and age, error rates and outside-service failures, with alerts; and data-quality checks, as each GDACS refresh already records its state, error type and repeated rows.

## 6. How this maps to the substrate: which entities did you build?

Brief, Section 5: "A live, queryable entity relationship graph across Product, Supplier, Customer, Location and Contact, so teams can answer which suppliers provide which products to which customers at which locations."

| Entity | In the MVP | Evidence |
|---|---|---|
| Supplier | Built | Sites and their owner companies (Open Supply Hub), with GLEIF parents once confirmed |
| Customer | Partly | The company whose list is loaded (`customer`), not which supplier serves which of its own customers |
| Location | Built, country only | Natural Earth's 1:50m states file covers 9 countries, not Vietnam |
| Product | Not used | Product words merge every contributor's words: 80 of adidas's 766 open sites have "NIKE" |
| Contact | Not built | Personal data, and rare: 3 of Amazon's 1,732 open sites have a point of contact; `claim_*` columns are dropped on load |
