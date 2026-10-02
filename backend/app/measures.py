"""Measures (rule R9) and the multi-hop questions. Every number carries its base ("known for X of Y")."""
import json

import psycopg
from babel import Locale

from . import gleif, hazards

BASIS_THRESHOLD = 0.90          # workers are the basis when known for >= 90% of open sites
HAZARD_LEVEL = {"Red": "High", "Orange": "High", "Green": "Watch"}
_TERRITORIES = Locale("en").territories


def level(share: float, high: float, watch: float) -> str | None:
    """High / Watch at the given percentages (defaults 10 / 5)."""
    pct = share * 100
    return "High" if pct >= high else "Watch" if pct >= watch else None


def coverage(cur: psycopg.Cursor, c: str) -> dict:
    cur.execute("""SELECT count(*) AS n, count(workers_est) AS workers_known,
                          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM site_owner o
                              WHERE o.customer_id = s.customer_id AND o.os_id = s.os_id)) AS owner_known,
                          count(location) AS location_known
                   FROM site s WHERE customer_id = %s""", (c,))
    r = cur.fetchone()
    n = r["n"]
    basis = "workers" if n and r["workers_known"] / n >= BASIS_THRESHOLD else "sites"
    return {"open_sites": n, "basis": basis,
            "workers_known": {"known": r["workers_known"], "of": n},
            "owner_known": {"known": r["owner_known"], "of": n},
            "location_known": {"known": r["location_known"], "of": n}}


def country_shares(cur: psycopg.Cursor, c: str, basis: str, high: float, watch: float) -> list[dict]:
    cur.execute("""SELECT country_code, count(*) AS sites, count(workers_est) AS workers_known,
                          coalesce(sum(workers_est), 0) AS workers
                   FROM site WHERE customer_id = %s GROUP BY country_code""", (c,))
    rows = cur.fetchall()
    key = "workers" if basis == "workers" else "sites"
    total = float(sum(r[key] for r in rows)) or 1.0
    out = [{"country_code": r["country_code"], "share": float(r[key]) / total, "sites": r["sites"],
            "workers_known": r["workers_known"], "level": level(float(r[key]) / total, high, watch)} for r in rows]
    return sorted(out, key=lambda x: (-x["share"], country_name(x["country_code"])))   # equal shares: by name, the same on every load


def owner_shares(cur: psycopg.Cursor, c: str, basis: str, high: float, watch: float) -> list[dict]:
    """A site with 2 or more owners counts in full under each owner."""
    cur.execute("""SELECT coalesce(sum(workers_est), 0) AS workers, count(*) AS sites FROM site WHERE customer_id = %s""", (c,))
    t = cur.fetchone()
    total = float(t["workers"] if basis == "workers" else t["sites"]) or 1.0
    cur.execute("""SELECT o.owner_name, count(*) AS sites, coalesce(sum(s.workers_est), 0) AS workers,
                          count(DISTINCT s.country_code) AS countries, min(s.country_code) AS country
                   FROM site_owner o JOIN site s USING (customer_id, os_id)
                   WHERE o.customer_id = %s GROUP BY o.owner_name""", (c,))
    out = []
    for r in cur.fetchall():
        share = float(r["workers"] if basis == "workers" else r["sites"]) / total
        out.append({"owner": r["owner_name"], "share": share, "sites": r["sites"], "level": level(share, high, watch),
                    "all_in_one_country": r["sites"] >= 2 and r["countries"] == 1,
                    "country": r["country"] if r["countries"] == 1 else None, "countries": r["countries"]})
    return sorted(out, key=lambda x: (-x["share"], -x["sites"], x["owner"]))


# A site's country is on the event's GDACS `affectedcountries` list; an event with no list (empty, or not stored yet)
# uses the area alone. A site with no country is not on any list.
LISTED = """(coalesce(cardinality(e.affected_countries), 0) = 0
             OR coalesce(s.country_code = ANY(e.affected_countries), false))"""


def _in_areas(cur: psycopg.Cursor, c: str, event_id: str | None, listed: bool) -> list[dict]:
    cur.execute(f"""SELECT DISTINCT s.os_id, s.name, s.country_code, e.event_id, e.name AS event_name, e.alert_level
                    FROM site s
                    JOIN hazard_area a ON ST_Intersects(a.area, s.location)
                    JOIN hazard_event e ON e.event_id = a.event_id AND e.is_current
                    WHERE s.customer_id = %s AND (%s::text IS NULL OR e.event_id = %s) AND {"" if listed else "NOT "}{LISTED}
                    ORDER BY e.event_id, s.os_id""", (c, event_id, event_id))
    return [dict(r, level=HAZARD_LEVEL.get(r["alert_level"]) if listed else None) for r in cur.fetchall()]


def hazard_sites(cur: psycopg.Cursor, c: str, event_id: str | None = None) -> list[dict]:
    """The company's sites inside a current GDACS event: the site's point is inside an affected area, and its
    country is in the event's affectedcountries list (an event with no list: the area alone)."""
    return _in_areas(cur, c, event_id, listed=True)


def hazard_sites_unlisted(cur: psycopg.Cursor, c: str, event_id: str | None = None) -> list[dict]:
    """Sites inside an affected area of a current event, in a country the event does not list: not counted,
    but shown (the hazard and site panels), so none is left out silently."""
    return _in_areas(cur, c, event_id, listed=False)


def hazard_areas(cur: psycopg.Cursor) -> list[dict]:
    """Current affected areas, simplified for drawing only (the inside check uses the stored shapes).
    Outer rings are made clockwise because d3-geo draws an anticlockwise ring as the whole globe minus the shape."""
    cur.execute("""SELECT e.event_id, e.event_type, e.name, e.alert_level,
                          ST_AsGeoJSON(ST_ForcePolygonCW(ST_SimplifyPreserveTopology(a.area, 0.02)), 3) AS geometry
                   FROM hazard_area a JOIN hazard_event e USING (event_id) WHERE e.is_current""")
    return [{"type": "Feature", "geometry": json.loads(r["geometry"]),
             "properties": {"event_id": r["event_id"], "event_type": r["event_type"], "name": r["name"],
                            "alert_level": r["alert_level"]}} for r in cur.fetchall()]


def country_name(code: str | None) -> str:
    """Full English country name (CLDR, the same data the browser's Intl.DisplayNames uses)."""
    return _TERRITORIES.get(code, code) if code else "Unknown country"


def _companies(n: int) -> str:
    return f"{n} owner {'company' if n == 1 else 'companies'}"


def sentence(cov: dict, countries: list[dict], owners: list[dict], hz_state: str, hz_sites: list[dict]) -> str:
    """The one-sentence summary for the CPO, in the screen's plain words. Its numbers follow the example in
    ARCHITECTURE_detailed.md, Appendix C.3."""
    high = [country_name(x["country_code"]) for x in countries if x["level"] == "High"]
    n_watch = sum(1 for x in countries if x["level"] == "Watch")
    parts = []
    lead = (f"{len(high)} {'country' if len(high) == 1 else 'countries'} at High ({', '.join(high)})" if high
            else "No countries at High")
    basis = ("your suppliers' workers" if cov["basis"] == "workers"
             else f"sites (workers known for {cov['workers_known']['known']} of {cov['open_sites']})")
    parts.append(f"{lead} and {n_watch} at Watch, by share of {basis}")
    o_high = sum(1 for o in owners if o["level"] == "High")
    o_watch = sum(1 for o in owners if o["level"] == "Watch")
    if o_high or o_watch:
        bits = ([f"{_companies(o_high)} at High"] if o_high else []) + \
               ([f"{o_watch} at Watch" if o_high else f"{_companies(o_watch)} at Watch"] if o_watch else [])
        parts.append(" and ".join(bits))
    else:
        parts.append(f"owner known for {cov['owner_known']['known']} of {cov['open_sites']} sites")
    if hz_state != "ok":
        parts.append("disaster data unavailable" if hz_state == "unavailable" else "checking for current disasters")
    else:
        inside = {s["os_id"] for s in hz_sites}
        if inside:
            levels = [a for a in ("Red", "Orange", "Green") if any(s["alert_level"] == a for s in hz_sites)]
            parts.append(f"{len(inside)} of your sites {'is' if len(inside) == 1 else 'are'} inside current "
                         f"disaster areas (alert: {', '.join(levels)})")
        else:
            parts.append("none of your sites is inside a current disaster area")
    return "; ".join(parts) + "."


def view(conn: psycopg.Connection, c: str, high: float = 10, watch: float = 5) -> dict | None:
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, name FROM customer WHERE customer_id = %s", (c,))
        customer = cur.fetchone()
        if not customer:
            return None
        cov = coverage(cur, c)
        countries = country_shares(cur, c, cov["basis"], high, watch)
        owners = owner_shares(cur, c, cov["basis"], high, watch)
        state = hazards.STATUS["state"]
        hz = hazard_sites(cur, c) if state == "ok" else []
        by_site: dict[str, str] = {}
        for h in hz:
            if by_site.get(h["os_id"]) != "High":
                by_site[h["os_id"]] = h["level"]
        cur.execute("""SELECT s.os_id, s.name, s.country_code, ST_X(s.location) AS lng, ST_Y(s.location) AS lat,
                              s.warnings, array_remove(array_agg(o.owner_name ORDER BY o.owner_name), NULL) AS owners
                       FROM site s LEFT JOIN site_owner o USING (customer_id, os_id)
                       WHERE s.customer_id = %s GROUP BY s.os_id, s.name, s.country_code, s.location, s.warnings""", (c,))
        sites = [dict(r, hazard_level=by_site.get(r["os_id"])) for r in cur.fetchall()]
        # the company's list names, as stored on its sites (each site's list_names joins them with " | ")
        cur.execute("""SELECT l FROM site, unnest(string_to_array(list_names, ' | ')) AS l
                       WHERE customer_id = %s GROUP BY l ORDER BY count(*) DESC, l""", (c,))
        lists = [r["l"] for r in cur.fetchall()]
        return {
            "customer": customer, "thresholds": {"high": high, "watch": watch}, "coverage": cov,
            "sentence": sentence(cov, countries, owners, state, hz),
            "countries": countries,
            "lists": lists,
            "owners": {"top": owners[:15], "all": owners, "at_high": sum(o["level"] == "High" for o in owners),
                       "at_watch": sum(o["level"] == "Watch" for o in owners),
                       "all_in_one_country": {"count": sum(o["all_in_one_country"] for o in owners),
                                              "of_owners_with_2_plus_sites": sum(o["sites"] >= 2 for o in owners)},
                       "owner_known": cov["owner_known"]},
            "hazards": {"status": dict(hazards.STATUS), "sites": hz,
                        "areas": {"type": "FeatureCollection", "features": hazard_areas(cur) if state == "ok" else []}},
            "sites": sites,
        }


def site_detail(conn: psycopg.Connection, c: str, os_id: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute("""SELECT os_id, name, country_code, ST_X(location) AS lng, ST_Y(location) AS lat,
                              workers_est, list_names, warnings FROM site WHERE customer_id = %s AND os_id = %s""", (c, os_id))
        site = cur.fetchone()
        if not site:
            return None
        cur.execute("SELECT owner_name FROM site_owner WHERE customer_id = %s AND os_id = %s ORDER BY 1", (c, os_id))
        owners = [r["owner_name"] for r in cur.fetchall()]
        ok = hazards.STATUS["state"] == "ok"
        hz = [h for h in hazard_sites(cur, c) if h["os_id"] == os_id] if ok else []
        unlisted = [h for h in hazard_sites_unlisted(cur, c) if h["os_id"] == os_id] if ok else []
        cur.execute("""SELECT m.lei, m.review_level, m.person_verdict FROM gleif_match m
                       WHERE m.customer_id = %s AND m.os_id = %s ORDER BY m.review_level, m.lei""", (c, os_id))
        matches = cur.fetchall()
        confirmed = [m for m in matches if m["person_verdict"] == "yes"]
        parents = []
        for m in confirmed:
            parents.append({"lei": m["lei"], "parents": gleif.parents_of(cur, m["lei"])})
        return {"site": dict(site, workers_est=float(site["workers_est"]) if site["workers_est"] is not None else None),
                "owners": owners, "hazards": hz, "hazards_unlisted": unlisted, "hazard_status": hazards.STATUS["state"],
                "gleif": {"candidates": len(matches), "confirmed": parents}}


def owner_detail(conn: psycopg.Connection, c: str, owner: str) -> dict | None:
    """Multi-hop: company -> sites -> owner -> that owner's other sites (same company)."""
    with conn.cursor() as cur:
        cur.execute("""SELECT s.os_id, s.name, s.country_code, ST_X(s.location) AS lng, ST_Y(s.location) AS lat
                       FROM site_owner o JOIN site s USING (customer_id, os_id)
                       WHERE o.customer_id = %s AND o.owner_name = %s ORDER BY s.country_code, s.name""", (c, owner))
        sites = cur.fetchall()
        if not sites:
            return None
        countries = sorted({s["country_code"] for s in sites if s["country_code"]})
        return {"owner": owner, "sites": sites, "countries": countries,
                "all_in_one_country": len(sites) >= 2 and len(countries) == 1}


def hazard_detail(conn: psycopg.Connection, c: str, event_id: str) -> dict | None:
    """Multi-hop: event -> its sites -> their owners -> those owners' other sites (same company)."""
    with conn.cursor() as cur:
        cur.execute("SELECT event_id, event_type, name, alert_level, is_current, coalesce(affected_countries, '{}') AS affected_countries "
                    "FROM hazard_event WHERE event_id = %s", (event_id,))
        event = cur.fetchone()
        if not event:
            return None
        inside = hazard_sites(cur, c, event_id)
        ids = [s["os_id"] for s in inside]
        # DISTINCT: two inside sites with the same owner would otherwise list that owner's other sites twice
        cur.execute("""SELECT DISTINCT o.owner_name, s2.os_id, s2.name, s2.country_code
                       FROM site_owner o
                       JOIN site_owner o2 ON o2.customer_id = o.customer_id AND o2.owner_name = o.owner_name
                       JOIN site s2 ON s2.customer_id = o2.customer_id AND s2.os_id = o2.os_id
                       WHERE o.customer_id = %s AND o.os_id = ANY(%s) AND NOT (o2.os_id = ANY(%s))
                       ORDER BY o.owner_name, s2.country_code, s2.name""", (c, ids, ids))
        other: dict[str, list] = {}
        for r in cur.fetchall():
            other.setdefault(r["owner_name"], []).append({"os_id": r["os_id"], "name": r["name"], "country_code": r["country_code"]})
        cur.execute("SELECT os_id, owner_name FROM site_owner WHERE customer_id = %s AND os_id = ANY(%s)", (c, ids))
        owners: dict[str, list] = {}
        for r in cur.fetchall():
            owners.setdefault(r["os_id"], []).append(r["owner_name"])
        return {"event": dict(event, level=HAZARD_LEVEL.get(event["alert_level"])),
                "sites": [dict(s, owners=sorted(owners.get(s["os_id"], []))) for s in inside],
                "unlisted": hazard_sites_unlisted(cur, c, event_id),      # inside the area, country not listed
                "owners_other_sites": other}
