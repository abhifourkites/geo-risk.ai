"""Company network page: the GLEIF candidates of the slice file (gleif.SLICE), the sites each links to,
the verdicts people give, and the graph for one candidate.

A verdict is stored in gleif_verdict and applied at once (every company's candidates are re-linked), and
again on every start (gleif.refresh_all). Every verdict starts empty.
"""
import csv
import io
from collections import defaultdict

import psycopg

from . import clean, gleif

MAX_SITES = 15                  # site nodes in a graph; the rest are "+N more"
LINK_LOCK = 724170              # advisory lock: one re-link of gleif_match at a time


def lock(cur: psycopg.Cursor) -> None:
    """Hold until the transaction ends, so two verdicts (or a verdict and an upload) do not re-link at once."""
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (LINK_LOCK,))


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
        return [c for c in gleif.BRANDS.get(r["our_brands"], []) if c in self.company]

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


def _saved(cur: psycopg.Cursor) -> dict[tuple[str, str, str], dict]:
    cur.execute("SELECT kind, our_names, lei, verdict, decided_at FROM gleif_verdict")
    return {(r["kind"], r["our_names"], r["lei"]): r for r in cur.fetchall()}


def _item(i: int, r: dict, sites: _Sites, saved: dict) -> dict:
    links = sites.links(r)
    os_ids = sorted({s for _, s, _ in links})
    s = saved.get((r["kind"], r["our_names"], r["LEI"]))
    file_verdict = (r.get(gleif.VERDICT_COLUMN) or "").strip().lower()
    return {
        "id": i, "kind": r["kind"], "our_names": r["our_names"], "names": _names(r),
        "companies": [sites.company[c] for c in sites.companies(r)],
        "sites": len(os_ids), "file_sites": int(r["our_sites"] or 0),
        "countries": sorted({sites.site[(c, o)]["country_code"] or "" for c, o, _ in links} - {""}),
        "review_level": r["review_level"], "level": r["review_level"][:1], "flags": r["flags"],
        "match_type": r["match_type"], "gleif_name_field": r["gleif_name_field"], "gleif_matched_name": r["gleif_matched_name"],
        "lei": r["LEI"], "gleif_legal_name": r["gleif_legal_name"], "gleif_country": r["legal_country"],
        "entity_status": r["entity_status"], "registration_status": r["registration_status"],
        "verdict": gleif.verdict_of(r, {k: v["verdict"] for k, v in saved.items()}),
        "verdict_from": "page" if s else ("file" if file_verdict in ("yes", "no") else None),
        "decided_at": s["decided_at"].isoformat() if s else None,
    }


def candidates(conn: psycopg.Connection) -> list[dict]:
    """Every row of the slice file (440), in the file's order; `id` is the row number."""
    rows = gleif._read(gleif.SLICE)
    with conn.cursor() as cur:
        sites, saved = _Sites(cur), _saved(cur)
    return [_item(i, r, sites, saved) for i, r in enumerate(rows, 1)]


def candidate(conn: psycopg.Connection, i: int) -> dict | None:
    """One candidate and its graph: companies -> sites (-> owner) -> GLEIF company; its parents only if confirmed."""
    rows = gleif._read(gleif.SLICE)
    if not 1 <= i <= len(rows):
        return None
    r = rows[i - 1]
    with conn.cursor() as cur:
        sites, saved = _Sites(cur), _saved(cur)
        item = _item(i, r, sites, saved)
        parents = []
        if item["verdict"] == "yes":
            cur.execute("SELECT type, parent_lei, parent_name FROM gleif_parent WHERE lei = %s ORDER BY type", (r["LEI"],))
            parents = cur.fetchall()
    by_site: dict[str, dict] = {}
    for c, os_id, owner in sites.links(r):
        s = sites.site[(c, os_id)]
        node = by_site.setdefault(os_id, {"os_id": os_id, "name": s["name"], "country_code": s["country_code"],
                                          "companies": [], "owners": []})
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
    }


def set_verdict(conn: psycopg.Connection, i: int, verdict: str | None) -> dict | None:
    """yes / no, or None to undo (back to the file's verdict, empty for every row today). Applied at once."""
    rows = gleif._read(gleif.SLICE)
    if not 1 <= i <= len(rows):
        return None
    r = rows[i - 1]
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
                  "given_on", "decided_at_utc"]


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
                        gleif.VERDICT_COLUMN: c["verdict"], "given_on": c["verdict_from"], "decided_at_utc": c["decided_at"] or ""})
    return buf.getvalue()
