"""R8 hazard counting and the GDACS refresh, with small hand-made GDACS data (no network).
Class and label strings are the real ones seen in GDACS responses on 2026-09-30."""
import asyncio
import datetime
import json

import httpx
import pytest

from app import hazards, measures

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}

R8_CASES = [
    # (event type, Class, polygonlabel, counted as affected?)
    ("TC", "Poly_Green", "60 km/h", True),
    ("TC", "Poly_Orange", "90 km/h", True),
    ("TC", "Poly_Red", "120 km/h", True),
    ("TC", "Poly_Green", "30/09 03:00", False),              # forecast: same class with a date label
    ("TC", "Poly_Red", "01/10 12:00", False),                # forecast
    ("TC", "Poly_Cones", "Uncertainty Cones", False),
    ("TC", "Point_Polygon_Point_0", "30/09 00:00 UTC", False),
    ("EQ", "Poly_SMPInt_0", "Intensity 0", True),
    ("EQ", "Poly_SMPInt_4.5", "Intensity 4.5", True),
    ("EQ", "Poly_SMPInt_5", "Intensity 5", True),
    ("EQ", "Poly_Circle", "100km", False),
    ("FL", "Poly_Affected", "Affected area", True),
    ("FL", "Poly_Global", "Global area", False),
    ("WF", "Poly_area", "Affected Area", True),
    ("DR", "Poly_area", "Affected Area", True),
    ("VO", "Poly_Cones_0", "OBS", True),
    ("VO", "Poly_Cones_6", "FCST 6h", False),                # forecast
    ("VO", "Poly_Cones_18", "FCST 18h", False),              # forecast
    ("VO", "Poly_Circle", "30Km", False),
]


@pytest.mark.parametrize("event_type,cls,label,expected", R8_CASES)
def test_r8_counting_table(event_type, cls, label, expected):
    assert hazards.is_affected(event_type, cls, label) is expected


def _feature(cls, label, geometry=SQUARE):
    return {"type": "Feature", "geometry": geometry, "properties": {"Class": cls, "polygonlabel": label}}


def test_only_affected_polygons_are_kept():
    tc = {"features": [
        _feature("Poly_Green", "60 km/h"), _feature("Poly_Orange", "90 km/h"),
        _feature("Poly_Orange", "30/09 03:00"), _feature("Poly_Cones", "Uncertainty Cones"),
        _feature("Point_Centroid", "Centroid", {"type": "Point", "coordinates": [0.5, 0.5]}),
        _feature("Line_Line_0", "TD", {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}),
    ]}
    assert [f["properties"]["polygonlabel"] for f in hazards.affected_features("TC", tc)] == ["60 km/h", "90 km/h"]
    fl = {"features": [_feature("Poly_Affected", "Affected area"), _feature("Poly_Global", "Global area")]}
    assert len(hazards.affected_features("FL", fl)) == 1


@pytest.fixture
def clean_hazards(conn, hazard_status):
    def wipe():
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("DELETE FROM hazard_event")          # cascades to hazard_area
    wipe()
    yield
    wipe()


def _site_square(conn, customer, os_id, half=0.001):     # about 100 m; the nearest other adidas site is ~0.0067 deg away
    with conn.cursor() as cur:
        cur.execute("SELECT ST_X(location) AS x, ST_Y(location) AS y FROM site WHERE customer_id = %s AND os_id = %s",
                    (customer, os_id))
        p = cur.fetchone()
    x, y = p["x"], p["y"]
    return {"type": "Polygon", "coordinates": [[[x - half, y - half], [x + half, y - half], [x + half, y + half],
                                                [x - half, y + half], [x - half, y - half]]]}


def _add_event(conn, event_id, alert, geometry, current=True):
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("INSERT INTO hazard_event (event_id, alert_level, is_current, event_type, episode_id, name) "
                    "VALUES (%s, %s, %s, 'FL', 1, %s)", (event_id, alert, current, f"Test {event_id}"))
        cur.execute("INSERT INTO hazard_area (event_id, area) VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))",
                    (event_id, json.dumps(geometry)))


SITE = ("adidas", "TR201909837HW3X")      # the flood control site used in the one-time GDACS check


def test_hazard_levels_r9(conn, clean_hazards, hazard_status):
    hazard_status.update(state="ok")
    square = _site_square(conn, *SITE)
    _add_event(conn, "FL1", "Green", square)
    _add_event(conn, "FL2", "Orange", square)
    _add_event(conn, "FL3", "Red", square, current=False)   # not current: not counted
    inside = measures.hazard_sites(conn.cursor(), "adidas")
    assert {(h["event_id"], h["level"]) for h in inside} == {("FL1", "Watch"), ("FL2", "High")}
    v = measures.view(conn, "adidas")
    site = next(s for s in v["sites"] if s["os_id"] == SITE[1])
    assert site["hazard_level"] == "High"                    # the highest level wins
    assert v["sentence"].endswith("1 open site inside current GDACS Orange and Green areas.")
    assert measures.hazard_sites(conn.cursor(), "apple") == []


def test_hazard_multi_hop(conn, clean_hazards, hazard_status):
    """event -> its sites -> their owners -> those owners' other sites."""
    hazard_status.update(state="ok")
    _add_event(conn, "FL1", "Green", _site_square(conn, *SITE))
    d = measures.hazard_detail(conn, "adidas", "FL1")
    assert [s["os_id"] for s in d["sites"]] == [SITE[1]]
    owners = d["sites"][0]["owners"]
    assert owners
    with conn.cursor() as cur:
        for owner, others in d["owners_other_sites"].items():
            assert owner in owners
            ids = [s["os_id"] for s in others]
            assert SITE[1] not in ids and len(ids) == len(set(ids))
            cur.execute("SELECT os_id FROM site_owner WHERE customer_id = 'adidas' AND owner_name = %s AND os_id <> %s",
                        (owner, SITE[1]))
            assert sorted(ids) == sorted(r["os_id"] for r in cur.fetchall())


def _gdacs_mock(pages, areas, seen):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        if "geteventlist" in request.url.path:
            return httpx.Response(200, json={"features": pages[int(request.url.params["pagenumber"]) - 1]})
        return httpx.Response(200, json=areas[request.url.params["eventid"]])
    return handler


def _event(eventid, current="true", modified="2026-09-29T10:00:00", episode=1, alert="Green"):
    return {"properties": {"eventtype": "FL", "eventid": eventid, "episodeid": episode, "iscurrent": current,
                           "alertlevel": alert, "name": f"Flood {eventid}", "datemodified": modified}}


def test_refresh_pages_filters_and_compares_datemodified(conn, clean_hazards, monkeypatch):
    real_client = httpx.AsyncClient
    seen: list[httpx.URL] = []
    area = {"features": [_feature("Poly_Affected", "Affected area"), _feature("Poly_Global", "Global area")]}
    pages = [[_event(1)] + [_event(1000 + i, current="false") for i in range(99)], [_event(2)]]   # 100, then 1
    areas = {"1": area, "2": area}

    def run(today=datetime.date(2026, 9, 30)):
        seen.clear()
        monkeypatch.setattr(httpx, "AsyncClient",
                            lambda **kw: real_client(transport=httpx.MockTransport(_gdacs_mock(pages, areas, seen)), **kw))
        return asyncio.run(hazards.refresh(conn, today=today))

    s = run()
    lists = [u for u in seen if "geteventlist" in u.path]
    assert [u.params["pagenumber"] for u in lists] == ["1", "2"]           # stops at the page with fewer than 100
    assert lists[0].params["alertlevel"] == "green;orange;red"
    assert (lists[0].params["fromdate"], lists[0].params["todate"]) == ("2026-08-31", "2026-09-30")
    assert (s["state"], s["current_events"], s["areas"], s["fetched"]) == ("ok", 2, 2, 2)   # Poly_Global not kept

    assert run()["fetched"] == 0                                           # nothing changed: no area requests

    pages[1] = [_event(2, modified="2026-09-30T08:00:00")]                  # event 2 changed
    assert run()["fetched"] == 1

    pages[1] = []                                                          # event 2 no longer current
    s = run()
    assert (s["current_events"], s["areas"]) == (1, 1)
    with conn.cursor() as cur:
        cur.execute("SELECT event_id, is_current FROM hazard_event ORDER BY 1")
        assert [(r["event_id"], r["is_current"]) for r in cur.fetchall()] == [("FL1", True), ("FL2", False)]


def test_gdacs_unreachable_keeps_the_app_working(conn, clean_hazards, hazard_status, monkeypatch):
    _add_event(conn, "FL1", "Green", _site_square(conn, *SITE))
    monkeypatch.setattr(hazards, "EVENT_LIST", "http://127.0.0.1:9/?f={fromdate}&t={todate}&p={page}")
    s = asyncio.run(hazards.refresh(conn))
    assert s["state"] == "unavailable"
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM hazard_area")
        assert cur.fetchone()["n"] == 1                                    # stored data left as it was
    v = measures.view(conn, "adidas")
    assert v["sentence"].endswith("hazard data unavailable.")
    assert v["coverage"]["open_sites"] == 766                              # the rest of the view still works
