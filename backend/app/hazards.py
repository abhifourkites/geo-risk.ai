"""GDACS hazard refresh (rule R8). Source: Global Disaster Awareness and Coordination System, GDACS.

GDACS alerts are automatic, not reviewed by people: confirm them before making decisions.
"""
import asyncio
import datetime
import json
import logging
import re

import httpx
import psycopg

EVENT_LIST = ("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist={type}"
              "&fromdate={fromdate}&todate={todate}&alertlevel=green;orange;red&pagesize=100&pagenumber={page}")
# One list read per type. The list is sorted by todate only, and many events share a todate, so the
# order of tied events changes from page to page: events repeat across pages and others are skipped.
# Read with all six types at once (1,844 rows, 30 Sep 2026), 17 events repeated and current droughts
# were missing, e.g. DR1015915. Read per type, TC, FL, VO and DR fit on one page and EQ repeated
# nothing; WF (13 pages) still repeats rows (24 in a read at 09:44 UTC), so WF events can still be missed.
# If every row of a type is distinct, no event of that type was skipped.
EVENT_TYPES = ("TC", "FL", "EQ", "VO", "DR", "WF")
EVENT_AREAS = "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype={type}&eventid={id}&episodeid={episode}"
MAX_PAGES = 100          # safety stop; paging normally ends when a page has fewer than 100 events
PARALLEL = 6             # at most 6 area requests at once

# The last refresh result in this backend process: loading, ok or unavailable.
STATUS: dict = {"state": "loading", "at": None, "current_events": None, "areas": None, "error": None,
                "repeated_rows": None, "repeated_by_type": None}

log = logging.getLogger(__name__)


def describe(err: BaseException) -> str:
    """An error's type and details, never empty: str() of some httpx errors is "" (the refresh after a
    backend restart on 30 Sep 2026 stored an empty error)."""
    return f"{type(err).__name__}: {err!r}"


RETRY_WAITS = (2, 5)     # seconds before the 2nd and the 3rd try of a failed GDACS request
_sleep = asyncio.sleep   # replaced in tests


async def _get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """GET from GDACS; on a network error or an HTTP error status, try up to 2 more times (after 2 s, then 5 s)."""
    for wait in (*RETRY_WAITS, None):
        try:
            r = await client.get(url)
            r.raise_for_status()
            return r
        except httpx.HTTPError as err:
            if wait is None:
                raise
            log.warning("GDACS request failed (%s); trying again in %s s: %s", describe(err), wait, url)
            await _sleep(wait)
    raise AssertionError("unreachable")


TC_AFFECTED = {("Poly_Green", "60 km/h"), ("Poly_Orange", "90 km/h"), ("Poly_Red", "120 km/h")}


def is_affected(event_type: str, cls: str, label: str) -> bool:
    """R8: only the 'counted as affected' classes. Forecast areas (TC classes with a date label,
    VO Poly_Cones_6/12/18), uncertainty cones, circles, points, lines and the flood 'Global area'
    are not counted."""
    if event_type == "TC":
        return (cls, label) in TC_AFFECTED
    if event_type == "FL":
        return cls == "Poly_Affected"
    if event_type == "EQ":
        return re.fullmatch(r"Poly_SMPInt_\d+(\.\d+)?", cls or "") is not None
    if event_type in ("WF", "DR"):
        return cls == "Poly_area"
    if event_type == "VO":
        return cls == "Poly_Cones_0"
    return False


def affected_features(event_type: str, collection: dict) -> list[dict]:
    return [f for f in collection.get("features", [])
            if (f.get("geometry") or {}).get("type") in ("Polygon", "MultiPolygon")
            and is_affected(event_type, f["properties"].get("Class"), f["properties"].get("polygonlabel"))]


async def fetch_current_events(client: httpx.AsyncClient, today: datetime.date) -> tuple[dict[str, dict], dict[str, int]]:
    """All current events in the window (today minus 30 days .. today), one row per event, read type by type.
    Also returns, per type, how many rows repeated a row already read for that type: each repeat means
    GDACS's paging may have skipped one event of that type."""
    events: dict[str, dict] = {}
    repeated: dict[str, int] = {}
    fromdate = (today - datetime.timedelta(days=30)).isoformat()
    for event_type in EVENT_TYPES:
        seen: set[tuple[str, str]] = set()
        for page in range(1, MAX_PAGES + 1):
            r = await _get(client, EVENT_LIST.format(type=event_type, fromdate=fromdate, todate=today.isoformat(), page=page))
            features = r.json().get("features", [])
            for f in features:
                p = f["properties"]
                row = (str(p["eventid"]), str(p["episodeid"]))
                if row in seen:
                    repeated[event_type] = repeated.get(event_type, 0) + 1
                seen.add(row)
                if str(p.get("iscurrent")).lower() != "true":
                    continue
                event_id = f"{p['eventtype']}{p['eventid']}"
                if event_id not in events or int(p["episodeid"]) > events[event_id]["episode_id"]:
                    events[event_id] = {"event_id": event_id, "event_type": p["eventtype"], "gdacs_id": p["eventid"],
                                        "episode_id": int(p["episodeid"]), "alert_level": p.get("alertlevel"),
                                        "name": p.get("name"), "date_modified": p.get("datemodified")}
            if len(features) < 100:
                break
    return events, repeated


async def refresh(conn: psycopg.Connection, today: datetime.date | None = None) -> dict:
    """List the current events; fetch the areas of new or changed events (compare datemodified);
    keep only affected areas. If GDACS cannot be reached, the stored data is left as it was."""
    today = today or datetime.date.today()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            events, repeated = await fetch_current_events(client, today)
            with conn.cursor() as cur:
                cur.execute("SELECT event_id, episode_id, date_modified FROM hazard_event")
                stored = {r["event_id"]: (r["episode_id"], r["date_modified"]) for r in cur.fetchall()}
            changed = [e for e in events.values()
                       if stored.get(e["event_id"]) != (e["episode_id"], e["date_modified"])]
            gate = asyncio.Semaphore(PARALLEL)

            async def areas(e: dict) -> tuple[str, list[dict]]:
                async with gate:
                    r = await _get(client, EVENT_AREAS.format(type=e["event_type"], id=e["gdacs_id"], episode=e["episode_id"]))
                    return e["event_id"], affected_features(e["event_type"], r.json())

            fetched = dict(await asyncio.gather(*(areas(e) for e in changed)))
    except (httpx.HTTPError, ValueError, KeyError) as err:
        message = describe(err)
        log.warning("GDACS refresh failed, stored disaster data kept: %s", message)
        STATUS.update(state="unavailable", at=datetime.datetime.now().isoformat(timespec="seconds"), error=message)
        return dict(STATUS)

    with conn.transaction(), conn.cursor() as cur:
        for e in events.values():
            cur.execute(
                "INSERT INTO hazard_event (event_id, alert_level, is_current, event_type, episode_id, name, date_modified) "
                "VALUES (%(event_id)s, %(alert_level)s, true, %(event_type)s, %(episode_id)s, %(name)s, %(date_modified)s) "
                "ON CONFLICT (event_id) DO UPDATE SET alert_level = EXCLUDED.alert_level, is_current = true, "
                "episode_id = EXCLUDED.episode_id, name = EXCLUDED.name, date_modified = EXCLUDED.date_modified", e)
        for event_id, features in fetched.items():
            cur.execute("DELETE FROM hazard_area WHERE event_id = %s", (event_id,))
            cur.executemany(
                "INSERT INTO hazard_area (event_id, area) "
                "VALUES (%s, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)))",
                [(event_id, json.dumps(f["geometry"])) for f in features])
        cur.execute("UPDATE hazard_event SET is_current = false WHERE NOT (event_id = ANY(%s))", (list(events),))
        cur.execute("SELECT count(*) AS n FROM hazard_area a JOIN hazard_event e USING (event_id) WHERE e.is_current")
        n_areas = cur.fetchone()["n"]
    STATUS.update(state="ok", at=datetime.datetime.now().isoformat(timespec="seconds"),
                  current_events=len(events), areas=n_areas, fetched=len(fetched), error=None,
                  repeated_rows=sum(repeated.values()), repeated_by_type=repeated)
    return dict(STATUS)
