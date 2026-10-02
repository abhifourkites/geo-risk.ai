"""GLEIF candidates and parents (rule R7).

- Candidates come from data/reference/gleif_slice_for_our_data.csv. They are re-linked to sites by name,
  only for the companies named in `our_brands` (adidas; Nike; both = adidas and Nike).
- Other companies get candidates from GLEIF's API (gleif_api.py, table gleif_api_candidate), one search per
  owner name; they are linked to that owner's sites the same way.
- Parents come from data/reference/rr_for_our_leis.csv (our LEI as the start node, company link types only),
  with names from data/reference/gleif_parents_checked.csv where known.
- A parent is shown only when a person has said yes: on the Company network page (table gleif_verdict),
  or in the slice file's `person_verdict` column. A verdict given on the page is used over the file's.
- One site can be linked to the same LEI by more than one candidate (for example its owner name and its site
  name). The verdicts given decide the link: yes (and no other) confirms it, no (and no other) rejects it,
  yes from one and no from another is a conflict: not confirmed, no parent shown, and the Company network
  page marks it for review. Candidates without a verdict do not count.
"""
import csv
import os
from collections import defaultdict
from pathlib import Path

import psycopg

from . import clean, rating

REF_DIR = Path(os.environ.get("DATA_DIR", "/data")) / "reference"
SLICE = REF_DIR / "gleif_slice_for_our_data.csv"
RELATIONSHIPS = REF_DIR / "rr_for_our_leis.csv"
PARENT_NAMES = REF_DIR / "gleif_parents_checked.csv"

BRANDS = {"adidas": ["adidas"], "Nike": ["nike"], "both": ["adidas", "nike"]}
TYPES = {"IS_DIRECTLY_CONSOLIDATED_BY": "direct", "IS_ULTIMATELY_CONSOLIDATED_BY": "top",
         "IS_INTERNATIONAL_BRANCH_OF": "branch"}
VERDICT_COLUMN = "person_verdict (same company? yes / no)"


def _read(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_parents(conn: psycopg.Connection) -> int:
    """Replace gleif_parent from the relationship extract."""
    names = {r["direct_parent_lei"]: r["direct_parent_name"] for r in _read(PARENT_NAMES) if r["direct_parent_lei"]}
    rows = {}
    for r in _read(RELATIONSHIPS):
        kind = TYPES.get(r["Relationship.RelationshipType"])
        if r["our_lei_is"] != "start" or not kind:
            continue
        lei, parent = r["Relationship.StartNode.NodeID"], r["Relationship.EndNode.NodeID"]
        rows[(lei, kind)] = (lei, parent, names.get(parent), kind)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM gleif_parent")
        cur.executemany("INSERT INTO gleif_parent (lei, parent_lei, parent_name, type) VALUES (%s, %s, %s, %s)",
                        list(rows.values()))
    return len(rows)


def saved_verdicts(cur: psycopg.Cursor) -> dict[tuple[str, str, str], str]:
    """(kind, our_names, LEI) -> yes / no, as given on the Company network page."""
    cur.execute("SELECT kind, our_names, lei, verdict FROM gleif_verdict")
    return {(r["kind"], r["our_names"], r["lei"]): r["verdict"] for r in cur.fetchall()}


LINK_LOCK = 724170              # advisory lock: one re-link of gleif_match at a time


def lock(cur: psycopg.Cursor) -> None:
    """Hold until the transaction ends, so verdicts, uploads and GLEIF API jobs do not re-link at once."""
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (LINK_LOCK,))


def file_rows() -> list[dict]:
    """The slice file's candidates, rated with the written rules like every other company's (rating.py).
    The file's own level is kept in `file_review_level`, for reference."""
    return [dict(r, review_level=rating.rate_file_row(r), file_review_level=r["review_level"]) for r in _read(SLICE)]


def api_rows(cur: psycopg.Cursor, customer_id: str | None = None) -> list[dict]:
    """GLEIF API candidates (gleif_api.py), shaped like rows of the slice file (kind owner)."""
    cur.execute("""SELECT id, customer_id, owner_name, lei, legal_name, legal_country, entity_status,
                          registration_status, category, review_level, flags, match_type, matched_name, name_field
                   FROM gleif_api_candidate WHERE %s::text IS NULL OR customer_id = %s
                   ORDER BY customer_id, owner_name, review_level, rank""", (customer_id, customer_id))
    return [{"api_id": r["id"], "customer_id": r["customer_id"], "kind": "owner", "our_names": r["owner_name"],
             "our_brands": None, "our_sites": "", "review_level": r["review_level"], "flags": r["flags"],
             "match_type": r["match_type"], "gleif_name_field": r["name_field"] or "LegalName",
             "gleif_matched_name": r["matched_name"] or r["legal_name"], "file_review_level": None,
             "LEI": r["lei"], "gleif_legal_name": r["legal_name"], "legal_country": r["legal_country"] or "",
             "entity_status": r["entity_status"] or "", "registration_status": r["registration_status"] or "",
             "entity_category": r["category"] or "", VERDICT_COLUMN: ""} for r in cur.fetchall()]


ENTITY_URL = "https://api.gleif.org/api/v1/lei-records/{lei}"   # one LEI's GLEIF record (gleif_api.py): a parent's name


def parents_of(cur: psycopg.Cursor, lei: str) -> list[dict]:
    """A confirmed match's parents: from the GLEIF files, else (a GLEIF API candidate) as fetched after its confirm.
    A parent whose name is not in our GLEIF files gets it from GLEIF's API, fetched once in the background
    (gleif_api.step). name_status: known, fetching, or not_available (GLEIF has no record, or the fetch failed)."""
    cur.execute("SELECT type, parent_lei, parent_name FROM gleif_parent WHERE lei = %s ORDER BY type", (lei,))
    rows = cur.fetchall()
    if not rows:
        cur.execute("SELECT type, parent_lei, parent_name FROM gleif_api_parent WHERE lei = %s AND parent_lei IS NOT NULL "
                    "ORDER BY type", (lei,))
        rows = cur.fetchall()
    out = []
    for p in rows:
        p = dict(p, name_status="known")
        if p["parent_name"] is None:
            cur.execute("SELECT status, body #>> '{data,attributes,entity,legalName,name}' AS name FROM gleif_api_cache "
                        "WHERE url = %s", (ENTITY_URL.format(lei=p["parent_lei"]),))
            hit = cur.fetchone()
            if hit and hit["status"] == 200 and hit["name"]:
                p["parent_name"] = hit["name"]
            else:
                p["name_status"] = "not_available" if hit else "fetching"
        out.append(p)
    return out


def verdict_of(r: dict, saved: dict[tuple[str, str, str], str]) -> str | None:
    """One candidate's verdict: the page's, else the file's (yes / no), else none."""
    v = saved.get((r["kind"], r["our_names"], r["LEI"])) or (r.get(VERDICT_COLUMN) or "").strip().lower()
    return v if v in ("yes", "no") else None


def link_customer(cur: psycopg.Cursor, customer_id: str) -> int:
    """Replace this company's GLEIF candidates, re-linked to its open sites by name (R7)."""
    cur.execute("DELETE FROM gleif_match WHERE customer_id = %s", (customer_id,))
    cur.execute("SELECT os_id, name FROM site WHERE customer_id = %s", (customer_id,))
    by_site_name: dict[str, list[str]] = {}
    for r in cur.fetchall():
        by_site_name.setdefault(clean.basic(r["name"]), []).append(r["os_id"])
    cur.execute("SELECT os_id, owner_name FROM site_owner WHERE customer_id = %s", (customer_id,))
    by_owner: dict[str, list[str]] = {}
    for r in cur.fetchall():
        by_owner.setdefault(r["owner_name"], []).append(r["os_id"])

    saved = saved_verdicts(cur)
    best: dict[tuple[str, str], str] = {}                  # (os_id, lei) -> the most likely review level (the rules)
    file_best: dict[tuple[str, str], str] = {}             # ... and the most likely level the slice file gave
    said: dict[tuple[str, str], set[str]] = defaultdict(set)   # (os_id, lei) -> the verdicts of its candidates
    rows = [r for r in file_rows() if customer_id in BRANDS.get(r["our_brands"], [])] + api_rows(cur, customer_id)
    for r in rows:
        names = [n for n in r["our_names"].split(" | ") if n.strip()]
        if r["kind"] == "owner":
            sites = {s for n in names for s in by_owner.get(clean.clean_owner(n), [])}
        else:
            sites = {s for n in names for s in by_site_name.get(clean.basic(n), [])}
        verdict = verdict_of(r, saved)
        for os_id in sites:
            key = (os_id, r["LEI"])
            if key not in best or r["review_level"] < best[key]:   # keep the most likely review level
                best[key] = r["review_level"]
            if r["file_review_level"] and (key not in file_best or r["file_review_level"] < file_best[key]):
                file_best[key] = r["file_review_level"]
            if verdict:
                said[key].add(verdict)
    combined = {k: "conflict" if len(v) > 1 else next(iter(v)) for k, v in said.items()}   # {yes, no}: a conflict
    keys = list(best)
    cur.execute("INSERT INTO gleif_match (customer_id, os_id, lei, review_level, person_verdict, file_review_level) "
                "SELECT %s, * FROM unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::text[])",      # one statement
                (customer_id, [k[0] for k in keys], [k[1] for k in keys], [best[k] for k in keys],
                 [combined.get(k) for k in keys], [file_best.get(k) for k in keys]))
    return len(best)


def relink_all(cur: psycopg.Cursor) -> None:
    """Re-link every company's candidates, with the current verdicts."""
    cur.execute("SELECT customer_id FROM customer")
    for c in [r["customer_id"] for r in cur.fetchall()]:
        link_customer(cur, c)


def refresh_all(conn: psycopg.Connection) -> None:
    """Re-read the GLEIF files for every company, with the saved verdicts. Runs on each start, so a verdict
    edited in the CSV takes effect after a restart; a verdict given on the page takes effect at once."""
    load_parents(conn)
    with conn.transaction(), conn.cursor() as cur:
        relink_all(cur)
