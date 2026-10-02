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
COATS_REJO = "213800TIMLY8NHYC2I61"            # PT. COATS REJO INDONESIA: likely, a GLEIF parent, no saved verdict
# the verdicts saved in the slice file (data/reference/gleif_slice_for_our_data.csv), by row
SAVED = {21: "PT. Paxar Indonesia", 22: "QINGDAO YALINA APPAREL CO.,LTD.", 23: "Qingdao Atago Apparel Co., Ltd.",
         59: "ACE TURTLE OMNI", 60: "ALPINE APPARELS"}


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


def test_every_candidate_is_listed_with_only_the_saved_verdicts():
    cs = candidates()
    assert len(cs) == 440
    assert collections.Counter(c["level"] for c in cs) == {"1": 33, "2": 201, "3": 206}           # the written rules
    assert collections.Counter(c["file_review_level"][0] for c in cs) == {"1": 30, "2": 48, "3": 362}   # the file's own
    assert collections.Counter(c["kind"] for c in cs) == {"owner": 391, "site": 49}
    decided = {c["id"]: (c["our_names"], c["verdict"], c["verdict_from"]) for c in cs if c["verdict"]}
    assert decided == {i: (n, "yes", "file") for i, n in SAVED.items()}        # adidas 4, Nike 1; nothing else


def test_the_list_follows_the_selected_company(conn):
    """The page shows the candidates of the company chosen in the top selector (their `company_ids` include it).
    A row on both lists has one verdict, but each company's row names only that company."""
    lists = {c: client.get("/api/network/candidates", params={"company": c}).json() for c in ("adidas", "nike", "apple", "samsung")}
    ids = {c: {x["id"] for x in v} for c, v in lists.items()}
    assert {c: len(v) for c, v in ids.items()} == {"adidas": 221, "nike": 345, "apple": 0, "samsung": 0}
    both = ids["adidas"] & ids["nike"]
    assert len(both) == 126 and len(ids["adidas"] | ids["nike"]) == 440
    assert {tuple(c["companies"]) for c in candidates() if c["id"] in both} == {("adidas", "Nike")}     # every company's
    assert {(tuple(x["companies"]), x["shared"]) for x in lists["adidas"] if x["id"] in both} == {(("adidas",), True)}
    assert {(tuple(x["companies"]), x["shared"]) for x in lists["nike"] if x["id"] in both} == {(("Nike",), True)}
    assert not any(x["shared"] for c in ("adidas", "nike") for x in lists[c] if x["id"] not in both)
    # an uploaded company has none: the slice file has adidas and Nike names only
    raw = (loader.DEMO_DIR / "samsung.csv").read_bytes()
    up = client.post("/api/uploads", files={"file": ("samsung.csv", raw, "text/csv")}).json()
    lst = "Samsung [Public List] (Samsung 2021 Facility List)"
    assert client.post(f"/api/uploads/{up['upload_id']}/confirm",
                       json={"name": "No Names Co", "lists": [lst], "current_lists": [lst]}).status_code == 200
    try:
        assert client.get("/api/network/candidates", params={"company": "no-names-co"}).json() == []
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM customer WHERE customer_id = 'no-names-co'")
        conn.commit()


def test_the_page_links_the_same_sites_as_the_stored_candidates(conn):
    """network._Sites finds sites by name as gleif.link_customer does: the same (company, site, LEI) links."""
    rows = gleif._read(gleif.SLICE)
    with conn.cursor() as cur:
        sites = network._Sites(cur)
        page = {(c, s, r["LEI"]) for r in rows for c, s, _ in sites.links(r)}
        cur.execute("SELECT customer_id, os_id, lei FROM gleif_match")
        stored = {(r["customer_id"], r["os_id"], r["lei"]) for r in cur.fetchall()}
    assert page == stored and len(stored) == 1854


def test_confirmed_paxar_shows_avery_dennison_as_its_parent():
    """PT. Paxar Indonesia's verdict is saved in the slice file, so an empty database shows its parent at once."""
    c = find(PAXAR)
    assert (c["names"], c["kind"], c["companies"], c["sites"], c["gleif_legal_name"], c["verdict"], c["verdict_from"]) == \
        (["PT. Paxar Indonesia"], "site", ["Nike"], 1, "PT PAXAR INDONESIA", "yes", "file")
    g = client.get(f"/api/network/candidates/{c['id']}").json()
    [site] = g["sites"]
    assert {(p["type"], p["parent_lei"], p["parent_name"]) for p in g["parents"]} == {
        ("direct", AVERY, "AVERY DENNISON CORPORATION"), ("top", AVERY, "AVERY DENNISON CORPORATION")}
    # the map's site panel, as for a "yes" in the CSV
    [m] = site_panel_parents("nike", site["os_id"])
    assert m["lei"] == PAXAR
    assert {(p["type"], p["parent_lei"], p["parent_name"]) for p in m["parents"]} == {
        ("direct", AVERY, "AVERY DENNISON CORPORATION"), ("top", AVERY, "AVERY DENNISON CORPORATION")}


def test_confirm_shows_the_parent_reject_hides_it_and_undo_clears_the_verdict(conn):
    c = find(COATS_REJO)
    os_id = client.get(f"/api/network/candidates/{c['id']}").json()["sites"][0]["os_id"]
    customer = "adidas" if "adidas" in c["company_ids"] else "nike"
    assert (c["verdict"], client.get(f"/api/network/candidates/{c['id']}").json()["parents"]) == (None, [])
    verdict(c["id"], "yes")
    assert {p["parent_name"] for p in client.get(f"/api/network/candidates/{c['id']}").json()["parents"]} == {"COATS GROUP PLC"}
    assert [m["lei"] for m in site_panel_parents(customer, os_id)] == [COATS_REJO]
    out = verdict(c["id"], "no")                              # a confirm can be changed to a reject
    assert (out["verdict"], out["verdict_from"]) == ("no", "page")
    assert client.get(f"/api/network/candidates/{c['id']}").json()["parents"] == []
    assert site_panel_parents(customer, os_id) == []
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT person_verdict FROM gleif_match WHERE lei = %s", (COATS_REJO,))
        assert [r["person_verdict"] for r in cur.fetchall()] == ["no"]

    out = verdict(c["id"], None)                              # undo: back to the file's verdict (none for this row)
    assert (out["verdict"], out["verdict_from"], out["decided_at"]) == (None, None, None)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM gleif_verdict")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT DISTINCT person_verdict FROM gleif_match WHERE lei = %s", (COATS_REJO,))
        assert [r["person_verdict"] for r in cur.fetchall()] == [None]


def test_a_verdict_on_the_page_is_used_over_the_saved_one_and_undo_goes_back_to_it(conn):
    c = find(PAXAR)
    os_id = client.get(f"/api/network/candidates/{c['id']}").json()["sites"][0]["os_id"]
    assert (verdict(c["id"], "no")["verdict"], site_panel_parents("nike", os_id)) == ("no", [])
    out = verdict(c["id"], None)
    assert (out["verdict"], out["verdict_from"]) == ("yes", "file")
    assert [m["lei"] for m in site_panel_parents("nike", os_id)] == [PAXAR]


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
    assert [(c["our_names"], c["level"], c["file_review_level"][0]) for c in rows] == [
        ("VERTICAL KNITS", "1", "1"), ("VERTICAL KNITS", "1", "2")]      # the rules: equal once DE CV is dropped
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
    assert (after[a["id"]]["conflict_with_names"], after[b["id"]]["conflict_with_names"]) == \
        (["FAR EASTERN NEW CENTURY (owner)"], ["FAR EASTERN (owner)"])
    # each company's page counts the conflict on its own sites only (FAR EASTERN NEW CENTURY: adidas 3, Nike 4)
    mine = {co: {c["id"]: c for c in client.get("/api/network/candidates", params={"company": co}).json()} for co in ("adidas", "nike")}
    assert [(mine[co][a["id"]]["conflict_with"], mine[co][a["id"]]["conflict_sites"], mine[co][a["id"]]["confirmed_sites"])
            for co in ("adidas", "nike")] == [([b["id"]], 3, 1), ([b["id"]], 4, 5)]
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


def test_a_shared_row_shows_each_company_only_its_own_sites(conn):
    """FAR EASTERN (owner, LEI 25490051NUU24RRHW523) is on adidas's and Nike's lists, with 9 sites in all: each
    company's row and graph have only its own sites and its own company node; the verdict is one for both."""
    i = find(FAR_EASTERN_LEI, "owner", "FAR EASTERN")["id"]
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, os_id, country_code FROM site_owner JOIN site USING (customer_id, os_id) "
                    "WHERE owner_name = 'FAR EASTERN'")
        owned = cur.fetchall()
    seen, graphs = {}, {}
    for co in ("adidas", "nike"):
        [seen[co]] = [x for x in client.get("/api/network/candidates", params={"company": co}).json() if x["id"] == i]
        graphs[co] = client.get(f"/api/network/candidates/{i}", params={"company": co}).json()
    assert {co: seen[co]["sites"] for co in seen} == {"adidas": 4, "nike": 9}
    name = {"adidas": "adidas", "nike": "Nike"}
    for co, c in seen.items():
        mine = [r for r in owned if r["customer_id"] == co]
        assert (c["companies"], c["company_ids"], c["shared"]) == ([name[co]], [co], True)
        assert c["countries"] == sorted({r["country_code"] for r in mine})
        g = graphs[co]
        assert g["companies"] == [{"customer_id": co, "name": name[co]}]
        assert sorted(s["os_id"] for s in g["sites"]) == sorted(r["os_id"] for r in mine)
        assert {tuple(s["companies"]) for s in g["sites"]} == {(co,)}
    assert graphs["adidas"]["more_sites"] == graphs["nike"]["more_sites"] == 0
    out = client.put(f"/api/network/candidates/{i}/verdict", params={"company": "adidas"}, json={"verdict": "yes"}).json()
    assert (out["verdict"], out["sites"], out["companies"]) == ("yes", 4, ["adidas"])
    assert [x["verdict"] for x in client.get("/api/network/candidates", params={"company": "nike"}).json() if x["id"] == i] == ["yes"]


def test_the_graph_shows_at_most_15_sites():
    """On a company's page: its largest candidate (today MAS on Nike's list, 16 Nike sites) shows 15 and "+N more"."""
    big, co = max(((c, co) for co in ("adidas", "nike")
                   for c in client.get("/api/network/candidates", params={"company": co}).json()), key=lambda x: x[0]["sites"])
    assert (big["our_names"], co, big["sites"]) == ("MAS", "nike", 16)
    g = client.get(f"/api/network/candidates/{big['id']}", params={"company": co}).json()
    assert (len(g["sites"]), g["more_sites"]) == (15, 1)


def test_download_verdicts_csv():
    c = find(PAXAR)
    verdict(c["id"], "yes")                                   # given again on the page
    r = client.get("/api/network/verdicts.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="gleif_verdicts.csv"' in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert list(rows[0]) == network.VERDICT_FIELDS
    assert [(row["our_names"], row[gleif.VERDICT_COLUMN], row["given_on"]) for row in rows] == \
        [(n, "yes", "page" if n == "PT. Paxar Indonesia" else "file") for n in SAVED.values()]
    # from a company's page: only that company's candidates
    mine = {co: [row["our_names"] for row in csv.DictReader(io.StringIO(
        client.get("/api/network/verdicts.csv", params={"company": co}).text))] for co in ("adidas", "nike")}
    assert mine == {"adidas": [SAVED[i] for i in (22, 23, 59, 60)], "nike": [SAVED[21]]}


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
    # PT. Paxar Indonesia is on Nike's list only: not shown, and not decided, from adidas's page
    paxar = find(PAXAR)["id"]
    assert client.get(f"/api/network/candidates/{paxar}", params={"company": "adidas"}).status_code == 404
    assert client.put(f"/api/network/candidates/{paxar}/verdict", params={"company": "adidas"}, json={"verdict": "no"}).status_code == 404
    assert client.delete(f"/api/network/candidates/{paxar}/verdict", params={"company": "adidas"}).status_code == 404
    assert (find(PAXAR)["verdict"], find(PAXAR)["verdict_from"]) == ("yes", "file")
