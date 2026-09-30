"""GLEIF candidates and parents (rule R7).

- Candidates come from data/reference/gleif_slice_for_our_data.csv. They are re-linked to sites by name,
  only for the companies named in `our_brands` (adidas; Nike; both = adidas and Nike).
- Parents come from data/reference/rr_for_our_leis.csv (our LEI as the start node, company link types only),
  with names from data/reference/gleif_parents_checked.csv where known.
- A parent is shown only when a person has set `person_verdict` to yes in the slice file.
"""
import csv
import os
from pathlib import Path

import psycopg

from . import clean

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

    best: dict[tuple[str, str], tuple[str, str]] = {}      # (os_id, lei) -> (review_level, verdict)
    for r in _read(SLICE):
        if customer_id not in BRANDS.get(r["our_brands"], []):
            continue
        names = [n for n in r["our_names"].split(" | ") if n.strip()]
        if r["kind"] == "owner":
            sites = {s for n in names for s in by_owner.get(clean.clean_owner(n), [])}
        else:
            sites = {s for n in names for s in by_site_name.get(clean.basic(n), [])}
        verdict = (r.get(VERDICT_COLUMN) or "").strip().lower()
        for os_id in sites:
            key = (os_id, r["LEI"])
            if key not in best or r["review_level"] < best[key][0]:   # keep the most likely review level
                best[key] = (r["review_level"], verdict)
    cur.executemany("INSERT INTO gleif_match (customer_id, os_id, lei, review_level, person_verdict) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    [(customer_id, os_id, lei, lvl, v or None) for (os_id, lei), (lvl, v) in best.items()])
    return len(best)


def refresh_all(conn: psycopg.Connection) -> None:
    """Re-read the GLEIF files for every company. Runs on each start, so a verdict edited in the CSV
    takes effect after a restart (the MVP has no review screen)."""
    load_parents(conn)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT customer_id FROM customer")
        for c in [r["customer_id"] for r in cur.fetchall()]:
            link_customer(cur, c)
