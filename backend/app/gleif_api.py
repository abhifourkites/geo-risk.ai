"""Automatic GLEIF candidates for any company, from GLEIF's API (https://api.gleif.org/api/v1).

GLEIF's documentation: "Rate limiting is currently set at 60 requests, per minute, per user", and
"There is no charge for the use of GLEIF's LEI data". Its fuzzy matching "does not guarantee that the LEI
belongs to the legal entity you are searching for", so every candidate waits for a person's verdict.

- One search per distinct owner name of the company (owners only), on the core name: commas and the R4
  legal-form words removed (plus PTE). filter[entity.legalName] means "contains", and a comma means OR,
  so a comma is never sent.
- At most 1 request per second; every response is cached in the database (gleif_api_cache), so a name or
  a parent is never fetched twice.
- Each result is rated with written rules (`rate`). Nothing is confirmed automatically.
- Parents are fetched only when a person confirms a candidate.
"""
import asyncio
import json
import logging
import math
import time

import httpx
import psycopg

from . import clean, db, gleif, hazards

API = "https://api.gleif.org/api/v1"
USER_AGENT = "geo-risk-ai/0.1 (FourKites take-home demo: GLEIF candidates for supplier owner names)"
PAGE_SIZE = 15                  # asked per search
KEEP = 10                       # kept per owner name, most likely first
MIN_INTERVAL = 1.0              # seconds between two requests: GLEIF allows 60 a minute
# R4's legal-form words, plus PTE: "BRANDIX ASIA" finds BRANDIX ASIA HOLDINGS PTE. LIMITED (SG); "BRANDIX ASIA PTE" finds nothing
SEARCH_DROP = clean.LEGAL_WORDS | {"PTE"}

LIKELY, POSSIBLE, UNLIKELY = "1 likely - confirm", "2 possible - check", "3 unlikely"


def core_name(owner: str) -> str:
    """The name searched: no commas (a comma means OR to GLEIF), and no legal-form words."""
    return " ".join(w for w in clean.basic(owner.replace(",", " ")).split() if w not in SEARCH_DROP)


def rate(our_name: str, countries: set[str], legal_name: str, legal_country: str, entity_status: str) -> str:
    """The written rules (DECISIONS #5). Names are compared after R4 cleaning (clean.clean_owner).
    - likely: the GLEIF legal name equals our owner name, its country is one of the owner's site countries,
      and the entity is ACTIVE;
    - possible: an equal name in another country, or the GLEIF name starts with our name (as whole words)
      in one of the owner's site countries ("HITACHI AMERICA", "AVERY DENNISON BELGIE");
    - unlikely: everything else."""
    ours, theirs = clean.clean_owner(our_name), clean.clean_owner(legal_name)
    same_country = legal_country in countries
    if ours and theirs == ours and same_country and entity_status == "ACTIVE":
        return LIKELY
    if ours and (theirs == ours or (same_country and theirs.startswith(ours + " "))):
        return POSSIBLE
    return UNLIKELY


def flags(entity_status: str, registration_status: str, category: str) -> str:
    out = []
    if entity_status != "ACTIVE":
        out.append("not active")
    if registration_status == "LAPSED":
        out.append("registration lapsed")
    if category == "FUND":
        out.append("fund")
    if category == "SOLE_PROPRIETOR":
        out.append("sole proprietor")
    return "; ".join(out)


def match_type(our_name: str, legal_name: str) -> str:
    ours, theirs = clean.clean_owner(our_name), clean.clean_owner(legal_name)
    return "exact" if theirs == ours else "starts_with" if theirs.startswith(ours + " ") else "contains"


# ---- requests: paced, retried, cached ---------------------------------------------------------------------
log = logging.getLogger(__name__)
_now, _sleep = time.monotonic, asyncio.sleep          # replaced in tests
_last_request: float | None = None


async def _pace() -> None:
    """At most one request per MIN_INTERVAL seconds, for the whole backend."""
    global _last_request
    if _last_request is not None:
        wait = MIN_INTERVAL - (_now() - _last_request)
        if wait > 0:
            await _sleep(wait)
    _last_request = _now()


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=60, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.api+json"})


def search_url(core: str) -> str:
    assert "," not in core, core            # a comma means OR to GLEIF
    return str(httpx.URL(f"{API}/lei-records", params={"filter[entity.legalName]": core, "page[size]": PAGE_SIZE}))


async def fetch(conn: psycopg.Connection, http: httpx.AsyncClient, url: str) -> tuple[int, dict | None, bool]:
    """(status, body, sent): from the cache if this URL was fetched before, else from GLEIF (and cached).
    A 404 (no such parent) is an answer too. Network errors, 5xx and 429 are retried (hazards._get), then raised."""
    with conn.cursor() as cur:
        cur.execute("SELECT status, body FROM gleif_api_cache WHERE url = %s", (url,))
        hit = cur.fetchone()
    if hit:
        return hit["status"], hit["body"], False
    await _pace()
    try:
        r = await hazards._get(http, url, source="GLEIF")
        status, body = r.status_code, r.json()
    except httpx.HTTPStatusError as err:
        if err.response.status_code != 404:
            raise
        status, body = 404, None
    with conn.cursor() as cur:
        cur.execute("INSERT INTO gleif_api_cache (url, status, body) VALUES (%s, %s, %s) ON CONFLICT (url) DO NOTHING",
                    (url, status, json.dumps(body) if body is not None else None))
    conn.commit()
    return status, body, True


# ---- one owner name -----------------------------------------------------------------------------------------
def _record(rec: dict) -> dict:
    a = rec["attributes"]
    e = a["entity"]
    return {"lei": a["lei"], "legal_name": e["legalName"]["name"], "legal_country": e["legalAddress"].get("country"),
            "entity_status": e.get("status"), "registration_status": (a.get("registration") or {}).get("status"),
            "category": e.get("category")}


def rated(owner: str, countries: set[str], records: list[dict]) -> list[dict]:
    """GLEIF's records for one owner name, rated, most likely first (then GLEIF's order); at most KEEP."""
    out = []
    for rank, rec in enumerate(records):
        x = _record(rec)
        out.append({**x, "rank": rank, "match_type": match_type(owner, x["legal_name"]),
                    "review_level": rate(owner, countries, x["legal_name"], x["legal_country"] or "", x["entity_status"] or ""),
                    "flags": flags(x["entity_status"] or "", x["registration_status"] or "", x["category"] or "")})
    return sorted(out, key=lambda x: (x["review_level"], x["rank"]))[:KEEP]


async def search_name(conn: psycopg.Connection, http: httpx.AsyncClient, customer_id: str, owner: str) -> bool:
    """Search one owner name, rate and store its candidates. True when a request was sent to GLEIF."""
    core = core_name(owner)
    with conn.cursor() as cur:
        cur.execute("""SELECT DISTINCT s.country_code FROM site_owner o JOIN site s USING (customer_id, os_id)
                       WHERE o.customer_id = %s AND o.owner_name = %s AND s.country_code IS NOT NULL""", (customer_id, owner))
        countries = {r["country_code"] for r in cur.fetchall()}
    sent, error, records = False, None, []
    if core:
        try:
            status, body, sent = await fetch(conn, http, search_url(core))
            records = (body or {}).get("data", []) if status == 200 else []
        except httpx.HTTPStatusError as err:                # a 4xx that retrying will not fix: this name only
            if hazards._worth_retrying(err):
                raise
            error = hazards.describe(err)
    keep = rated(owner, countries, records)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM gleif_api_candidate WHERE customer_id = %s AND owner_name = %s AND NOT (lei = ANY(%s))",
                    (customer_id, owner, [k["lei"] for k in keep]))
        for k in keep:
            cur.execute("""INSERT INTO gleif_api_candidate (customer_id, owner_name, lei, rank, legal_name, legal_country,
                               entity_status, registration_status, category, review_level, flags, match_type)
                           VALUES (%(c)s, %(o)s, %(lei)s, %(rank)s, %(legal_name)s, %(legal_country)s, %(entity_status)s,
                               %(registration_status)s, %(category)s, %(review_level)s, %(flags)s, %(match_type)s)
                           ON CONFLICT (customer_id, owner_name, lei) DO UPDATE SET rank = EXCLUDED.rank,
                               legal_name = EXCLUDED.legal_name, legal_country = EXCLUDED.legal_country,
                               entity_status = EXCLUDED.entity_status, registration_status = EXCLUDED.registration_status,
                               category = EXCLUDED.category, review_level = EXCLUDED.review_level, flags = EXCLUDED.flags,
                               match_type = EXCLUDED.match_type""", {**k, "c": customer_id, "o": owner})
        cur.execute("UPDATE gleif_api_name SET done = true, results = %s, error = %s WHERE customer_id = %s AND owner_name = %s",
                    (len(records), error, customer_id, owner))
        cur.execute("UPDATE gleif_api_job SET names_done = names_done + 1, requests = requests + %s WHERE customer_id = %s",
                    (int(sent), customer_id))
    return sent


# ---- jobs ---------------------------------------------------------------------------------------------------
def eligible(customer_id: str) -> bool:
    """Companies whose candidates come from the slice file (adidas, Nike) are not searched: they keep theirs."""
    return not any(customer_id in cs for cs in gleif.BRANDS.values())


def enqueue(conn: psycopg.Connection, customer_id: str) -> dict | None:
    """Queue a search of every distinct owner name of the company (again after an upload: answers already
    fetched come from the cache, and are rated again with the new sites). Commits, so the worker sees it."""
    if not eligible(customer_id):
        return None
    conn.commit()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT DISTINCT owner_name FROM site_owner WHERE customer_id = %s", (customer_id,))
        owners = sorted(r["owner_name"] for r in cur.fetchall())
        cur.execute("DELETE FROM gleif_api_candidate WHERE customer_id = %s AND NOT (owner_name = ANY(%s))", (customer_id, owners))
        cur.execute("DELETE FROM gleif_api_name WHERE customer_id = %s", (customer_id,))
        for o in owners:
            cur.execute("INSERT INTO gleif_api_name (customer_id, owner_name, core_name) VALUES (%s, %s, %s)", (customer_id, o, core_name(o)))
        cur.execute("""INSERT INTO gleif_api_job (customer_id, state, names_total) VALUES (%s, 'queued', %s)
                       ON CONFLICT (customer_id) DO UPDATE SET state = 'queued', names_total = EXCLUDED.names_total,
                           names_done = 0, requests = 0, created_at = now(), started_at = NULL, finished_at = NULL, error = NULL""",
                    (customer_id, len(owners)))
    return job(conn, customer_id)


def job(conn: psycopg.Connection, customer_id: str) -> dict:
    """The company's search job, and how many names would still need a request (the others are cached)."""
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM gleif_api_job WHERE customer_id = %s", (customer_id,))
        j = cur.fetchone()
        cur.execute("SELECT DISTINCT owner_name FROM site_owner WHERE customer_id = %s", (customer_id,))
        cores = {core_name(r["owner_name"]) for r in cur.fetchall()} - {""}
        cur.execute("SELECT url FROM gleif_api_cache WHERE url = ANY(%s)", ([search_url(c) for c in cores],))
        uncached = len(cores) - len(cur.fetchall())
    out = {"customer_id": customer_id, "eligible": eligible(customer_id), "state": None, "names_total": None,
           "names_done": None, "requests": None, "error": None, "started_at": None, "finished_at": None}
    if j:
        out.update({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in j.items() if k in out})
    out["names"] = len(cores)
    out["to_search"] = uncached
    out["minutes"] = max(1, math.ceil(uncached * MIN_INTERVAL / 60)) if uncached else 0
    return out


def _relink(conn: psycopg.Connection, customer_id: str) -> None:
    with conn.transaction(), conn.cursor() as cur:
        gleif.lock(cur)
        gleif.link_customer(cur, customer_id)


async def fetch_parents(conn: psycopg.Connection, http: httpx.AsyncClient, lei: str) -> None:
    """Direct and ultimate parent of a confirmed API candidate (two requests, cached)."""
    for kind, path in (("direct", "direct-parent"), ("top", "ultimate-parent")):
        status, body, _ = await fetch(conn, http, f"{API}/lei-records/{lei}/{path}")
        parent = _record(body["data"]) if status == 200 and body and body.get("data") else None
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO gleif_api_parent (lei, type, parent_lei, parent_name) VALUES (%s, %s, %s, %s)
                           ON CONFLICT (lei, type) DO UPDATE SET parent_lei = EXCLUDED.parent_lei, parent_name = EXCLUDED.parent_name""",
                        (lei, kind, parent and parent["lei"], parent and parent["legal_name"]))
        conn.commit()


def parents_pending(cur: psycopg.Cursor) -> list[str]:
    """LEIs of confirmed API candidates whose parents are not fetched yet (and not known from the GLEIF files)."""
    cur.execute("""SELECT DISTINCT c.lei FROM gleif_api_candidate c
                   JOIN gleif_verdict v ON v.kind = 'owner' AND v.our_names = c.owner_name AND v.lei = c.lei AND v.verdict = 'yes'
                   WHERE NOT EXISTS (SELECT 1 FROM gleif_api_parent p WHERE p.lei = c.lei AND p.type = 'top')
                     AND NOT EXISTS (SELECT 1 FROM gleif_parent p WHERE p.lei = c.lei)
                   ORDER BY 1""")
    return [r["lei"] for r in cur.fetchall()]


async def step(conn: psycopg.Connection, http: httpx.AsyncClient) -> bool:
    """One unit of work: the parents of one confirmed candidate, else one owner name of the oldest job.
    False when there is nothing to do."""
    with conn.cursor() as cur:
        pending = parents_pending(cur)
    conn.commit()
    if pending:
        await fetch_parents(conn, http, pending[0])
        return True
    with conn.cursor() as cur:
        cur.execute("""SELECT j.customer_id, n.owner_name FROM gleif_api_job j
                       LEFT JOIN gleif_api_name n ON n.customer_id = j.customer_id AND NOT n.done
                       WHERE j.state IN ('queued', 'running') ORDER BY j.created_at, n.owner_name LIMIT 1""")
        nxt = cur.fetchone()
    conn.commit()
    if not nxt:
        return False
    c = nxt["customer_id"]
    if nxt["owner_name"] is None:                         # every name done: link the candidates to the sites
        _relink(conn, c)
        with conn.cursor() as cur:
            cur.execute("UPDATE gleif_api_job SET state = 'done', finished_at = now() WHERE customer_id = %s", (c,))
        conn.commit()
        return True
    with conn.cursor() as cur:
        cur.execute("UPDATE gleif_api_job SET state = 'running', started_at = coalesce(started_at, now()) WHERE customer_id = %s", (c,))
    conn.commit()
    try:
        await search_name(conn, http, c, nxt["owner_name"])
    except (httpx.HTTPError, ValueError, KeyError) as err:   # GLEIF unreachable after the retries: stop this job
        conn.rollback()
        message = hazards.describe(err)
        log.warning("GLEIF search failed, job for %s stopped: %s", c, message)
        with conn.cursor() as cur:
            cur.execute("UPDATE gleif_api_job SET state = 'failed', finished_at = now(), error = %s WHERE customer_id = %s", (message, c))
        conn.commit()
    return True


async def run_until_idle(http: httpx.AsyncClient, connect=db.connect) -> None:
    """Do every pending unit of work (used by the worker and the tests)."""
    while True:
        with connect() as conn:
            if not await step(conn, http):
                return


async def worker() -> None:
    """Runs for the life of the backend: picks up queued jobs (also after a restart) and parent fetches."""
    async with client() as http:
        while True:
            try:
                await run_until_idle(http)
            except Exception:                              # never stop the worker; the job state says what failed
                log.exception("GLEIF worker error")
                await asyncio.sleep(5)
            await asyncio.sleep(1)
