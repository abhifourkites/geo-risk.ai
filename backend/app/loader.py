"""Load and clean one company's Open Supply Hub file (rules R1-R4).

One load replaces only that company's rows, in one transaction.
"""
import csv
import datetime
import io
import json
import os
from collections import Counter
from pathlib import Path

import psycopg

from . import clean

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DEMO_DIR = DATA_DIR / "demo"


def read_rows(raw: bytes) -> list[dict]:
    """Read an Open Supply Hub CSV. Every claim_* column (personal contact details) is dropped."""
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    return [{k: v for k, v in row.items() if k is not None and not k.startswith("claim_")} for row in reader]


def list_counts(rows: list[dict]) -> list[dict]:
    """Every distinct string in `contributor (list)`, with the number of sites (rows) that name it."""
    counts = Counter(s for r in rows for s in set(clean.split_pipe(r.get("contributor (list)"))))
    return [{"list": s, "sites": n} for s, n in counts.most_common()]


def _point(row: dict) -> tuple[float, float] | None:
    try:
        return float(row["lng"]), float(row["lat"])
    except (KeyError, TypeError, ValueError):
        return None


def prepare_sites(rows: list[dict], lists: list[str], current: list[str], as_of: datetime.date) -> list[dict]:
    """R1 open sites; R2 workers; R3 warnings; R4 owners."""
    picked = lists + [c for c in current if c not in lists]           # the company's lists, in the order given
    cur = set(current)
    shared = Counter((r.get("lat"), r.get("lng")) for r in rows)    # R3: same coordinates as another row of the file
    out = []
    for r in rows:
        on = set(clean.split_pipe(r.get("contributor (list)")))
        if not (on & cur) or r.get("is_closed") == "True":             # R1: on a current list and not closed
            continue
        owner_names = clean.owners(r.get("name", ""), r.get("parent_company", ""))
        warnings = []
        if shared[(r.get("lat"), r.get("lng"))] > 1:
            warnings.append("same_coordinates")
        if len(owner_names) > 1:
            warnings.append("owner_conflict")
        warnings += clean.certificate_warnings(r, as_of)
        out.append({
            "os_id": r["os_id"],
            "name": r.get("name", ""),
            "country_code": r.get("country_code") or None,
            "point": _point(r),
            "workers_est": clean.workers(r.get("number_of_workers", "")),
            "list_names": " | ".join(s for s in picked if s in on),
            "warnings": warnings,
            "owners": owner_names,
        })
    return out


def load_customer(conn: psycopg.Connection, customer_id: str, name: str, raw: bytes,
                  lists: list[str], current: list[str], as_of: datetime.date | None = None) -> dict:
    """Replace this company's sites, owners and GLEIF candidates in one transaction."""
    from . import gleif   # imported here to avoid a cycle

    as_of = as_of or datetime.date.today()
    sites = prepare_sites(read_rows(raw), lists, current, as_of)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("INSERT INTO customer (customer_id, name) VALUES (%s, %s) "
                        "ON CONFLICT (customer_id) DO UPDATE SET name = EXCLUDED.name", (customer_id, name))
            cur.execute("DELETE FROM site WHERE customer_id = %s", (customer_id,))   # cascades to owners and matches
            cur.executemany(
                "INSERT INTO site (customer_id, os_id, name, country_code, location, workers_est, list_names, warnings) "
                "VALUES (%s, %s, %s, %s, CASE WHEN %s::float8 IS NULL THEN NULL "
                "ELSE ST_SetSRID(ST_MakePoint(%s::float8, %s::float8), 4326) END, %s, %s, %s)",
                [(customer_id, s["os_id"], s["name"], s["country_code"],
                  s["point"] and s["point"][0], s["point"] and s["point"][0], s["point"] and s["point"][1],
                  s["workers_est"], s["list_names"], s["warnings"]) for s in sites])
            cur.executemany("INSERT INTO site_owner (customer_id, os_id, owner_name) VALUES (%s, %s, %s)",
                            [(customer_id, s["os_id"], o) for s in sites for o in s["owners"]])
            matches = gleif.link_customer(cur, customer_id)
    return {"customer_id": customer_id, "open_sites": len(sites), "gleif_matches": matches, "as_of": as_of.isoformat()}


def seed_demo(conn: psycopg.Connection) -> list[dict]:
    """On first start (no companies yet), load the 4 demo companies from data/demo/demo_companies.json."""
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM customer")
        if cur.fetchone()["n"]:
            return []
    done = []
    for c in json.loads((DEMO_DIR / "demo_companies.json").read_text(encoding="utf-8")):
        raw = (DEMO_DIR / c["file"]).read_bytes()
        done.append(load_customer(conn, c["customer_id"], c["name"], raw, c["lists"], c["current_lists"]))
    return done
