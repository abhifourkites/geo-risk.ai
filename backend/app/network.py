"""Company network page: the GLEIF candidates, the sites each links to, the verdicts people give, and the
graph for one candidate. Candidates come from the slice file (gleif.SLICE; ids 1-440, its row numbers) and
from GLEIF's API (gleif_api.py; ids API_ID + n, one per owner name and LEI, shared by every company that
has that owner name).

A verdict is stored in gleif_verdict and applied at once (every company's candidates are re-linked), and
again on every start (gleif.refresh_all). Every verdict starts empty. A site-LEI link with yes from one
candidate and no from another is a conflict (gleif_match.person_verdict = 'conflict'): it is not confirmed,
and both candidates are marked "conflicting verdicts - needs review".
"""
import csv
import io
from collections import defaultdict

import psycopg

from . import clean, gleif

MAX_SITES = 15                  # site nodes in a graph; the rest are "+N more"
API_ID = 100000                 # ids of GLEIF API candidates start above the slice file's rows
lock = gleif.lock               # one re-link of gleif_match at a time (verdicts, uploads, GLEIF API jobs)


def _names(r: dict) -> list[str]:
    return [n for n in r["our_names"].split(" | ") if n.strip()]


class _Sites:
    """The open sites of the companies named in gleif.BRANDS, found by name as gleif.link_customer finds them."""

    def __init__(self, cur: psycopg.Cursor):
        cur.execute("SELECT customer_id, name FROM customer")
        self.company = {r["customer_id"]: r["name"] for r in cur.fetchall()}
        cur.execute("SELECT customer_id, os_id, name, country_code FROM site")
        self.site, self.by_name = {}, defaultdict(list)
        for r in cur.fetchall():
            self.site[(r["customer_id"], r["os_id"])] = r
            self.by_name[(r["customer_id"], clean.basic(r["name"]))].append(r["os_id"])
        cur.execute("SELECT customer_id, os_id, owner_name FROM site_owner")
        self.by_owner = defaultdict(list)
        for r in cur.fetchall():
            self.by_owner[(r["customer_id"], r["owner_name"])].append(r["os_id"])

    def companies(self, r: dict) -> list[str]:
        ids = r["customer_ids"] if r.get("customer_ids") is not None else gleif.BRANDS.get(r["our_brands"], [])
        return [c for c in ids if c in self.company]

    def links(self, r: dict) -> list[tuple[str, str, str | None]]:
        """(customer_id, os_id, owner name or None) for every site this candidate links to."""
        out = set()
        for c in self.companies(r):
            for n in _names(r):
                if r["kind"] == "owner":
                    owner = clean.clean_owner(n)
                    out |= {(c, s, owner) for s in self.by_owner.get((c, owner), [])}
                else:
                    out |= {(c, s, None) for s in self.by_name.get((c, clean.basic(n)), [])}
        return sorted(out)


def _rows(cur: psycopg.Cursor) -> dict[int, dict]:
    """Every candidate by id: the slice file's rows, then the GLEIF API candidates (one per owner name and
    LEI: its companies are every company with that owner name searched; its level the most likely one, and
    `own` each company's own row, rated with that company's site countries)."""
    rows = {i: dict(r, source="file") for i, r in enumerate(gleif.file_rows(), 1)}
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in gleif.api_rows(cur):
        grouped[(r["our_names"], r["LEI"])].append(r)
    best = {k: min(g, key=lambda r: (r["review_level"], r["api_id"])) for k, g in grouped.items()}
    for k in sorted(grouped, key=lambda k: (best[k]["review_level"], k[0], best[k]["api_id"])):   # most likely first
        same, first = grouped[k], best[k]
        rows[API_ID + min(r["api_id"] for r in same)] = dict(
            first, source="api", customer_ids=sorted({r["customer_id"] for r in same}),
            own={r["customer_id"]: r for r in same})
    return rows


def _key(r: dict) -> tuple[str, str, str]:
    return r["kind"], r["our_names"], r["LEI"]


def _saved(cur: psycopg.Cursor) -> dict[tuple[str, str, str], dict]:
    cur.execute("SELECT kind, our_names, lei, verdict, decided_at FROM gleif_verdict")
    return {(r["kind"], r["our_names"], r["lei"]): r for r in cur.fetchall()}


def _linked(cur: psycopg.Cursor) -> dict[tuple[str, str, str], str]:
    """(customer_id, os_id, lei) -> the link's verdict as stored in gleif_match: yes, no or conflict."""
    cur.execute("SELECT customer_id, os_id, lei, person_verdict FROM gleif_match WHERE person_verdict IS NOT NULL")
    return {(r["customer_id"], r["os_id"], r["lei"]): r["person_verdict"] for r in cur.fetchall()}


def _conflicts(rows: dict[int, dict], sites: _Sites, saved: dict, linked: dict) -> dict[int, list[int]]:
    """Candidate id -> the other candidates that give the opposite verdict on one of its site-LEI links."""
    verdicts = {k: v["verdict"] for k, v in saved.items()}
    given: dict[tuple[str, str, str], list[tuple[int, str]]] = defaultdict(list)
    for i, r in rows.items():
        v = gleif.verdict_of(r, verdicts)
        if v:
            for c, s, _ in sites.links(r):
                if linked.get((c, s, r["LEI"])) == "conflict":
                    given[(c, s, r["LEI"])].append((i, v))
    out: dict[int, set[int]] = defaultdict(set)
    for on_link in given.values():
        for i, v in on_link:
            out[i] |= {j for j, w in on_link if w != v}
    return {i: sorted(js) for i, js in out.items()}


def _applies_to(rows: dict[int, dict], sites: _Sites) -> dict[tuple[str, str, str], list[str]]:
    """Question (kind, names, LEI) -> every company its verdict applies to (one verdict per question)."""
    out: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for r in rows.values():
        for c in sites.companies(r):
            if c not in out[_key(r)]:
                out[_key(r)].append(c)
    return out


def _item(i: int, r: dict, rows: dict[int, dict], sites: _Sites, saved: dict, linked: dict, conflicts: dict,
          applies: dict) -> dict:
    links = sites.links(r)
    os_ids = sorted({s for _, s, _ in links})

    def state(v: str) -> set[str]:      # this candidate's sites whose link to its LEI is stored as v
        return {s for c, s, _ in links if linked.get((c, s, r["LEI"])) == v}

    s = saved.get((r["kind"], r["our_names"], r["LEI"]))
    file_verdict = (r.get(gleif.VERDICT_COLUMN) or "").strip().lower()
    return {
        "id": i, "source": r["source"], "kind": r["kind"], "our_names": r["our_names"], "names": _names(r),
        "companies": [sites.company[c] for c in sites.companies(r)], "company_ids": sites.companies(r),
        "applies_to": [sites.company[c] for c in applies.get(_key(r), [])],     # a verdict covers all of them
        "sites": len(os_ids), "file_sites": int(r["our_sites"] or 0),
        "countries": sorted({sites.site[(c, o)]["country_code"] or "" for c, o, _ in links} - {""}),
        "review_level": r["review_level"], "level": r["review_level"][:1], "flags": r["flags"],
        "file_review_level": r.get("file_review_level"),   # the slice file's own level, for reference
        "match_type": r["match_type"], "gleif_name_field": r["gleif_name_field"], "gleif_matched_name": r["gleif_matched_name"],
        "lei": r["LEI"], "gleif_legal_name": r["gleif_legal_name"], "gleif_country": r["legal_country"],
        "entity_status": r["entity_status"], "registration_status": r["registration_status"],
        "verdict": gleif.verdict_of(r, {k: v["verdict"] for k, v in saved.items()}),
        "verdict_from": "page" if s else ("file" if file_verdict in ("yes", "no") else None),
        "decided_at": s["decided_at"].isoformat() if s else None,
        "confirmed_sites": len(state("yes")),           # sites whose link to this LEI is confirmed
        "conflict_sites": len(state("conflict")),       # ... has yes and no from two candidates
        "conflict_with": conflicts.get(i, []),          # the candidates (ids) that give the opposite verdict
        "conflict_with_names": [f'{" / ".join(_names(rows[j]))} ({rows[j]["kind"]})' for j in conflicts.get(i, [])],
    }


def _context(cur: psycopg.Cursor) -> tuple:
    rows = _rows(cur)
    sites, saved, linked = _Sites(cur), _saved(cur), _linked(cur)
    return rows, sites, saved, linked, _conflicts(rows, sites, saved, linked), _applies_to(rows, sites)


def candidates(conn: psycopg.Connection, company: str | None = None) -> list[dict]:
    """Every candidate: the slice file's 440 rows in its order (`id` is the row number), then the GLEIF API
    candidates. With `company` (a customer_id): only the candidates whose companies include it (from the
    file: adidas 221, Nike 345; 126 are both's)."""
    with conn.cursor() as cur:
        rows, sites, saved, linked, conflicts, applies = _context(cur)
    items = [_item(i, r, rows, sites, saved, linked, conflicts, applies) for i, r in rows.items()
             if company is None or company in sites.companies(r)]
    if company:       # a GLEIF API candidate is shown with the company's own rating (its own site countries)
        for c in items:
            own = rows[c["id"]].get("own", {}).get(company)
            if own:
                c.update(review_level=own["review_level"], level=own["review_level"][:1], match_type=own["match_type"])
        items = [c for c in items if c["source"] == "file"] + \
            sorted((c for c in items if c["source"] == "api"), key=lambda c: (c["review_level"], c["our_names"], c["id"]))
    return items





def candidate(conn: psycopg.Connection, i: int) -> dict | None:
    """One candidate and its graph: companies -> sites (-> owner) -> GLEIF company; its parents only if confirmed
    (yes, and at least one of its site links confirmed: not every link in conflict)."""
    with conn.cursor() as cur:
        rows, sites, saved, linked, conflicts, applies = _context(cur)
        if i not in rows:
            return None
        r = rows[i]
        item = _item(i, r, rows, sites, saved, linked, conflicts, applies)
        parents, fetching = [], False
        if item["verdict"] == "yes" and item["confirmed_sites"]:
            parents = gleif.parents_of(cur, r["LEI"])
            if r["source"] == "api" and not parents:     # fetched in the background after the confirm
                cur.execute("SELECT 1 FROM gleif_api_parent WHERE lei = %s AND type = 'top'", (r["LEI"],))
                fetching = cur.fetchone() is None
    by_site: dict[str, dict] = {}
    for c, os_id, owner in sites.links(r):
        s = sites.site[(c, os_id)]
        node = by_site.setdefault(os_id, {"os_id": os_id, "name": s["name"], "country_code": s["country_code"],
                                          "companies": [], "owners": [], "conflict": False})
        node["conflict"] |= linked.get((c, os_id, r["LEI"])) == "conflict"
        if c not in node["companies"]:
            node["companies"].append(c)
        if owner and owner not in node["owners"]:
            node["owners"].append(owner)
    listed = sorted(by_site.values(), key=lambda s: (s["country_code"] or "", s["name"], s["os_id"]))
    return {
        "candidate": item,
        "companies": [{"customer_id": c, "name": sites.company[c]} for c in sites.companies(r)],
        "sites": listed[:MAX_SITES], "more_sites": max(0, len(listed) - MAX_SITES),
        "owners": sorted({o for s in listed for o in s["owners"]}),
        "parents": parents,
        "parents_fetching": fetching,
    }


def set_verdict(conn: psycopg.Connection, i: int, verdict: str | None) -> dict | None:
    """yes / no, or None to undo (back to the file's verdict, empty for every row today). Applied at once.
    A yes on a GLEIF API candidate also queues the fetch of its parents (gleif_api.step)."""
    with conn.cursor() as cur:
        rows = _rows(cur)
    conn.commit()
    if i not in rows:
        return None
    r = rows[i]
    with conn.transaction(), conn.cursor() as cur:
        lock(cur)
        if verdict:
            cur.execute("""INSERT INTO gleif_verdict (kind, our_names, lei, verdict) VALUES (%s, %s, %s, %s)
                           ON CONFLICT (kind, our_names, lei) DO UPDATE SET verdict = EXCLUDED.verdict, decided_at = now()""",
                        (r["kind"], r["our_names"], r["LEI"], verdict))
        else:
            cur.execute("DELETE FROM gleif_verdict WHERE kind = %s AND our_names = %s AND lei = %s",
                        (r["kind"], r["our_names"], r["LEI"]))
        gleif.relink_all(cur)
    return candidate(conn, i)["candidate"]


VERDICT_FIELDS = ["kind", "our_names", "LEI", "gleif_legal_name", "review_level", gleif.VERDICT_COLUMN,
                  "given_on", "decided_at_utc", "file_review_level"]


def verdicts_csv(conn: psycopg.Connection) -> str:
    """The verdicts in effect, one row per candidate that has one, in the slice file's order. The first five
    columns and the verdict column are named as in the slice file."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=VERDICT_FIELDS, lineterminator="\n")
    w.writeheader()
    for c in candidates(conn):
        if c["verdict"]:
            w.writerow({"kind": c["kind"], "our_names": c["our_names"], "LEI": c["lei"],
                        "gleif_legal_name": c["gleif_legal_name"], "review_level": c["review_level"],
                        gleif.VERDICT_COLUMN: c["verdict"], "given_on": c["verdict_from"], "decided_at_utc": c["decided_at"] or "",
                        "file_review_level": c["file_review_level"] or ""})
    return buf.getvalue()
