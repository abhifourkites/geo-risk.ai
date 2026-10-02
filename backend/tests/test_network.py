"""Company network page: GLEIF candidates, verdicts given on the page (table gleif_verdict), the graph.
A "restart" runs the app's start-up (lifespan) again on the test database; GDACS is not called."""
import collections
import csv
import io

import pytest
from fastapi.testclient import TestClient

from app import gleif, loader, main, measures, network
from app.main import app

client = TestClient(app)          # no lifespan; `restart()` runs it
PAXAR, AVERY = "549300YDGYNJ5OSNWF92", "549300PW7VPFCYKLIV37"


@pytest.fixture(autouse=True)
def no_verdicts(conn):
    """Every test starts and ends with no verdict, as the app does."""
    yield
    with conn.cursor() as cur:
        cur.execute("DELETE FROM gleif_verdict")
        gleif.relink_all(cur)
    conn.commit()


def restart(monkeypatch):
    """The backend's start-up: create missing tables, seed only an empty database, re-link GLEIF candidates."""
    async def no_gdacs():
        return {}
    monkeypatch.setattr(main, "_refresh_hazards", no_gdacs)
    with TestClient(app):
        pass


def candidates() -> list[dict]:
    r = client.get("/api/network/candidates")
    assert r.status_code == 200, r.text
    return r.json()


def find(lei: str, kind: str | None = None, names: str | None = None) -> dict:
    [c] = [c for c in candidates() if c["lei"] == lei and kind in (None, c["kind"]) and names in (None, c["our_names"])]
    return c


def verdict(i: int, v: str | None) -> dict:
    r = client.put(f"/api/network/candidates/{i}/verdict", json={"verdict": v}) if v else \
        client.delete(f"/api/network/candidates/{i}/verdict")
    assert r.status_code == 200, r.text
    return r.json()


def site_panel_parents(customer: str, os_id: str) -> list[dict]:
    return client.get(f"/api/customers/{customer}/sites/{os_id}").json()["gleif"]["confirmed"]


def test_every_candidate_is_listed_and_every_verdict_starts_empty():
    cs = candidates()
    assert len(cs) == 440
    assert collections.Counter(c["level"] for c in cs) == {"1": 30, "2": 48, "3": 362}
    assert collections.Counter(c["kind"] for c in cs) == {"owner": 391, "site": 49}
    assert {c["verdict"] for c in cs} == {None} and {c["verdict_from"] for c in cs} == {None}


def test_the_page_links_the_same_sites_as_the_stored_candidates(conn):
    """network._Sites finds sites by name as gleif.link_customer does: the same (company, site, LEI) links."""
    rows = gleif._read(gleif.SLICE)
    with conn.cursor() as cur:
        sites = network._Sites(cur)
        page = {(c, s, r["LEI"]) for r in rows for c, s, _ in sites.links(r)}
        cur.execute("SELECT customer_id, os_id, lei FROM gleif_match")
        stored = {(r["customer_id"], r["os_id"], r["lei"]) for r in cur.fetchall()}
    assert page == stored and len(stored) == 1854


def test_confirming_paxar_shows_avery_dennison_as_its_parent():
    c = find(PAXAR)
    assert (c["names"], c["kind"], c["companies"], c["sites"], c["gleif_legal_name"]) == \
        (["PT. Paxar Indonesia"], "site", ["Nike"], 1, "PT PAXAR INDONESIA")
    g = client.get(f"/api/network/candidates/{c['id']}").json()
    assert g["parents"] == []                                 # not shown before a verdict
    [site] = g["sites"]

    assert verdict(c["id"], "yes")["verdict"] == "yes"
    g = client.get(f"/api/network/candidates/{c['id']}").json()
    assert {(p["type"], p["parent_lei"], p["parent_name"]) for p in g["parents"]} == {
        ("direct", AVERY, "AVERY DENNISON CORPORATION"), ("top", AVERY, "AVERY DENNISON CORPORATION")}
    # the map's site panel, as for a "yes" in the CSV
    [m] = site_panel_parents("nike", site["os_id"])
    assert m["lei"] == PAXAR
    assert {(p["type"], p["parent_lei"], p["parent_name"]) for p in m["parents"]} == {
        ("direct", AVERY, "AVERY DENNISON CORPORATION"), ("top", AVERY, "AVERY DENNISON CORPORATION")}


def test_reject_hides_the_parent_and_undo_clears_the_verdict(conn):
    c = find(PAXAR)
    os_id = client.get(f"/api/network/candidates/{c['id']}").json()["sites"][0]["os_id"]
    verdict(c["id"], "yes")
    out = verdict(c["id"], "no")                              # a confirm can be changed to a reject
    assert (out["verdict"], out["verdict_from"]) == ("no", "page")
    assert client.get(f"/api/network/candidates/{c['id']}").json()["parents"] == []
    assert site_panel_parents("nike", os_id) == []
    with conn.cursor() as cur:
        cur.execute("SELECT person_verdict FROM gleif_match WHERE lei = %s", (PAXAR,))
        assert [r["person_verdict"] for r in cur.fetchall()] == ["no"]

    out = verdict(c["id"], None)                              # undo: back to the file's verdict (empty)
    assert (out["verdict"], out["verdict_from"], out["decided_at"]) == (None, None, None)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM gleif_verdict")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT person_verdict FROM gleif_match WHERE lei = %s", (PAXAR,))
        assert [r["person_verdict"] for r in cur.fetchall()] == [None]


def test_verdicts_survive_a_restart(monkeypatch):
    c = find(PAXAR)
    os_id = client.get(f"/api/network/candidates/{c['id']}").json()["sites"][0]["os_id"]
    verdict(c["id"], "yes")
    other = next(x for x in candidates() if x["lei"] != PAXAR and x["level"] == "3")
    verdict(other["id"], "no")
    restart(monkeypatch)
    after = {x["id"]: x for x in candidates()}
    assert (after[c["id"]]["verdict"], after[other["id"]]["verdict"]) == ("yes", "no")
    [m] = site_panel_parents("nike", os_id)
    assert {p["parent_name"] for p in m["parents"]} == {"AVERY DENNISON CORPORATION"}


def test_an_uploaded_company_survives_a_restart(conn, monkeypatch):
    raw = (loader.DEMO_DIR / "samsung.csv").read_bytes()
    up = client.post("/api/uploads", files={"file": ("samsung.csv", raw, "text/csv")}).json()
    lst = "Samsung [Public List] (Samsung 2021 Facility List)"
    r = client.post(f"/api/uploads/{up['upload_id']}/confirm", json={"name": "Restart Check", "lists": [lst], "current_lists": [lst]})
    assert r.status_code == 200, r.text
    before = client.get("/api/customers/restart-check/view").json()
    try:
        restart(monkeypatch)
        customers = {x["customer_id"]: x["open_sites"] for x in client.get("/api/customers").json()}
        assert customers["restart-check"] == 187
        assert {k: customers[k] for k in ("adidas", "nike", "apple", "samsung")} == \
            {"adidas": 766, "nike": 625, "apple": 749, "samsung": 187}
        after = client.get("/api/customers/restart-check/view").json()
        assert after["coverage"] == before["coverage"] and after["countries"] == before["countries"]
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM customer WHERE customer_id = 'restart-check'")
        conn.commit()


def test_the_two_rows_of_one_question_share_a_verdict():
    """VERTICAL KNITS / 4469000001E9305R6057 is in the file twice (an exact match on another name, and a
    starts-with match on the legal name): the same question, so one verdict."""
    rows = [c for c in candidates() if c["lei"] == "4469000001E9305R6057"]
    assert [(c["our_names"], c["level"]) for c in rows] == [("VERTICAL KNITS", "1"), ("VERTICAL KNITS", "2")]
    verdict(rows[0]["id"], "yes")
    assert [c["verdict"] for c in candidates() if c["lei"] == "4469000001E9305R6057"] == ["yes", "yes"]


# Site VN2019318A8P7HW (adidas and Nike) is linked to LEI 25490051NUU24RRHW523, which has a GLEIF parent,
# by two candidates: its owner names FAR EASTERN and FAR EASTERN NEW CENTURY.
FAR_EASTERN_LEI, SHARED_SITE = "25490051NUU24RRHW523", "VN2019318A8P7HW"


def _two_candidates() -> tuple[dict, dict]:
    return find(FAR_EASTERN_LEI, "owner", "FAR EASTERN"), find(FAR_EASTERN_LEI, "owner", "FAR EASTERN NEW CENTURY")


def _link(conn) -> list[tuple[str, str | None]]:
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, person_verdict FROM gleif_match WHERE os_id = %s AND lei = %s ORDER BY 1",
                    (SHARED_SITE, FAR_EASTERN_LEI))
        return [(r["customer_id"], r["person_verdict"]) for r in cur.fetchall()]


def _panel_leis(customer: str, os_id: str) -> set[str]:
    return {m["lei"] for m in site_panel_parents(customer, os_id)}


def test_a_verdict_from_one_of_two_candidates_decides_the_link(conn):
    a, b = _two_candidates()
    verdict(a["id"], "yes")                                   # yes, and nothing from the other: confirmed
    assert _link(conn) == [("adidas", "yes"), ("nike", "yes")]
    assert FAR_EASTERN_LEI in _panel_leis("adidas", SHARED_SITE)
    verdict(a["id"], None)
    verdict(b["id"], "no")                                    # no, and nothing from the other: rejected
    assert _link(conn) == [("adidas", "no"), ("nike", "no")]
    assert FAR_EASTERN_LEI not in _panel_leis("adidas", SHARED_SITE)
    assert {c["id"]: c["conflict_with"] for c in candidates() if c["id"] in (a["id"], b["id"])} == {a["id"]: [], b["id"]: []}


def test_yes_and_no_on_one_link_is_a_conflict(conn):
    a, b = _two_candidates()
    assert (a["sites"], b["sites"]) == (9, 4)                 # FAR EASTERN NEW CENTURY's 4 sites are all FAR EASTERN's too
    verdict(a["id"], "yes")
    verdict(b["id"], "no")
    assert _link(conn) == [("adidas", "conflict"), ("nike", "conflict")]
    # not confirmed: no parent for this LEI in the site panel of a shared site; still shown on FAR EASTERN's other sites
    assert FAR_EASTERN_LEI not in _panel_leis("adidas", SHARED_SITE)
    assert FAR_EASTERN_LEI in _panel_leis("adidas", "CN2019093WZSXE8")
    # the list marks both candidates, each naming the other
    after = {c["id"]: c for c in candidates()}
    assert [(after[x]["conflict_with"], after[x]["conflict_sites"], after[x]["confirmed_sites"]) for x in (a["id"], b["id"])] == \
        [([b["id"]], 4, 5), ([a["id"]], 4, 0)]
    assert sum(bool(c["conflict_with"]) for c in after.values()) == 2
    g = client.get(f"/api/network/candidates/{a['id']}").json()
    assert g["parents"] and sorted(s["os_id"] for s in g["sites"] if s["conflict"]) == \
        ["CN2019083CS0EQJ", "TW2019085FK2HTK", "VN2019318A8P7HW", "VN2023063ZEX4WY"]

    # the other way round, every link of FAR EASTERN NEW CENTURY is in conflict: its yes confirms nothing
    verdict(a["id"], "no")
    verdict(b["id"], "yes")
    g = client.get(f"/api/network/candidates/{b['id']}").json()
    assert (g["candidate"]["verdict"], g["candidate"]["confirmed_sites"], g["parents"]) == ("yes", 0, [])
    assert FAR_EASTERN_LEI not in _panel_leis("nike", SHARED_SITE)

    verdict(a["id"], None)                                    # undo one side: no conflict, the other verdict decides
    assert _link(conn) == [("adidas", "yes"), ("nike", "yes")]
    assert [c["conflict_with"] for c in candidates() if c["id"] in (a["id"], b["id"])] == [[], []]


def test_the_graph_shows_at_most_15_sites():
    big = max(candidates(), key=lambda c: c["sites"])
    assert big["sites"] > 15
    g = client.get(f"/api/network/candidates/{big['id']}").json()
    assert (len(g["sites"]), g["more_sites"]) == (15, big["sites"] - 15)


def test_download_verdicts_csv():
    c = find(PAXAR)
    verdict(c["id"], "yes")
    r = client.get("/api/network/verdicts.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="gleif_verdicts.csv"' in r.headers["content-disposition"]
    [row] = list(csv.DictReader(io.StringIO(r.text)))
    assert list(row) == network.VERDICT_FIELDS
    assert (row["kind"], row["our_names"], row["LEI"], row[gleif.VERDICT_COLUMN], row["given_on"]) == \
        ("site", "PT. Paxar Indonesia", PAXAR, "yes", "page")


def test_verdicts_do_not_change_the_numbers(conn):
    before = {c: measures.view(conn, c) for c in ("adidas", "nike")}
    for c in candidates():
        if c["level"] == "1":
            verdict(c["id"], "yes")
    for c, v in before.items():
        assert measures.view(conn, c) == v


def test_bad_requests():
    assert client.get("/api/network/candidates/0").status_code == 404
    assert client.get("/api/network/candidates/441").status_code == 404
    assert client.put("/api/network/candidates/1/verdict", json={"verdict": "maybe"}).status_code == 400
