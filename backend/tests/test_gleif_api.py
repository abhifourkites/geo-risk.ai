"""GLEIF API candidates (gleif_api.py) with a fake GLEIF (no network): core-name search, no commas sent,
the rating rules, at most 10 kept, 1 request a second, the cache, a 429 retry, parents only after a confirm."""
import asyncio
import json
import urllib.parse

import httpx
import pytest
from fastapi.testclient import TestClient

from app import gleif, gleif_api, hazards, measures, network
from app.main import app

client = TestClient(app)
L, P, U = gleif_api.LIKELY, gleif_api.POSSIBLE, gleif_api.UNLIKELY
REAL_CLIENT = httpx.AsyncClient


def record(lei, name, country, status="ACTIVE", reg="ISSUED", category="GENERAL"):
    """A GLEIF lei-record, the fields gleif_api reads (shape as the live API returned it on 2 Oct 2026)."""
    return {"type": "lei-records", "id": lei, "attributes": {
        "lei": lei, "registration": {"status": reg},
        "entity": {"legalName": {"name": name, "language": "en"}, "legalAddress": {"country": country},
                   "status": status, "category": category}}}


class FakeGleif:
    """Answers lei-records searches from `names` (core name -> records) and parent requests from `parents`
    (LEI -> {"direct-parent": record, ...}; missing: 404). `fail` = status codes to answer first."""

    def __init__(self, names=None, parents=None, fail=()):
        self.names, self.parents, self.fail = names or {}, parents or {}, list(fail)
        self.requests: list[tuple[float, httpx.Request]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((gleif_api._now(), request))
        if self.fail:
            return httpx.Response(self.fail.pop(0), json={"errors": [{"status": "x"}]})
        path = request.url.path.removeprefix("/api/v1/lei-records")
        if not path:
            return httpx.Response(200, json={"data": self.names.get(request.url.params["filter[entity.legalName]"], [])})
        lei, kind = path.strip("/").split("/")
        parent = self.parents.get(lei, {}).get(kind)
        return httpx.Response(200, json={"data": parent}) if parent else httpx.Response(404, json={"errors": [{"status": "404"}]})

    def searched(self) -> list[str]:
        return [r.url.params["filter[entity.legalName]"] for _, r in self.requests if r.url.path.endswith("/lei-records")]

    def parent_requests(self) -> list[str]:
        return [r.url.path for _, r in self.requests if not r.url.path.endswith("/lei-records")]


@pytest.fixture
def fake(monkeypatch, conn):
    """A fake GLEIF, a virtual clock (no real waiting), and an empty GLEIF API state before and after."""
    clock = {"t": 0.0}
    waits: list[float] = []

    async def sleep(s):
        waits.append(s)
        clock["t"] += s
    monkeypatch.setattr(gleif_api, "_now", lambda: clock["t"])
    monkeypatch.setattr(gleif_api, "_sleep", sleep)
    monkeypatch.setattr(gleif_api, "_last_request", None)
    monkeypatch.setattr(hazards, "_sleep", sleep)                # the retry waits (2 s, 5 s)
    g = FakeGleif()
    g.waits = waits
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(g.handler), **kw))

    def wipe():
        with conn.cursor() as cur:
            for t in ("gleif_api_job", "gleif_api_name", "gleif_api_candidate", "gleif_api_parent", "gleif_api_cache", "gleif_verdict"):
                cur.execute(f"DELETE FROM {t}")
            gleif.relink_all(cur)
        conn.commit()
    wipe()
    yield g
    wipe()


def run(conn, customer="apple"):
    gleif_api.enqueue(conn, customer)

    async def go():
        async with gleif_api.client() as http:
            await gleif_api.run_until_idle(http)
    asyncio.run(go())
    return gleif_api.job(conn, customer)


def test_the_core_name_has_no_commas_and_no_legal_form_words():
    assert gleif_api.core_name("YKK TAIWAN CO., LTD.") == "YKK TAIWAN"      # "a comma means OR" (2 Oct 2026)
    assert gleif_api.core_name("BRANDIX ASIA PTE") == "BRANDIX ASIA"        # with PTE nothing was found
    assert gleif_api.core_name("Intel Corporation") == "INTEL"
    assert gleif_api.core_name("LTD") == ""                                  # nothing left: not searched
    url = gleif_api.search_url("BRANDIX ASIA")
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    assert (q["filter[entity.legalName]"], q["page[size]"]) == (["BRANDIX ASIA"], ["15"])
    with pytest.raises(AssertionError):
        gleif_api.search_url("YKK TAIWAN CO., LTD.")


@pytest.mark.parametrize("ours,countries,theirs,country,status,expected", [
    ("INTEL", {"US", "IE"}, "INTEL CORPORATION", "US", "ACTIVE", L),         # equal after R4, a site country, active
    ("INTEL", {"US", "IE"}, "Intel Corporation", "NL", "ACTIVE", P),         # equal name, another country
    ("INTEL", {"US", "IE"}, "INTEL CORPORATION", "US", "INACTIVE", P),       # equal, same country, not active
    ("HITACHI", {"US"}, "HITACHI AMERICA, LTD.", "US", "ACTIVE", P),          # a subsidiary: starts with our name
    ("AVERY DENNISON", {"BE"}, "Avery Dennison België", "BE", "ACTIVE", P),
    ("INTEL", {"US", "IE"}, "INTEL INVEST", "CY", "ACTIVE", U),              # the live "Intel" search's first result
    ("HITACHI", {"US"}, "HITACHI AMERICA, LTD.", "JP", "ACTIVE", U),          # starts with, but another country
    ("INTEL", {"US"}, "INTELLIGENT SYSTEMS INC", "US", "ACTIVE", U),         # not as whole words
    ("BRANDIX ASIA PTE", {"MX"}, "BRANDIX ASIA HOLDINGS PTE. LIMITED", "SG", "ACTIVE", P),   # HOLDINGS is an R4 word: equal, other country
])
def test_rating_rules(ours, countries, theirs, country, status, expected):
    assert gleif_api.rate(ours, countries, theirs, country, status) == expected


def test_flags():
    assert gleif_api.flags("ACTIVE", "ISSUED", "GENERAL") == ""
    assert gleif_api.flags("INACTIVE", "LAPSED", "FUND") == "not active; registration lapsed; fund"
    assert gleif_api.flags("ACTIVE", "ISSUED", "SOLE_PROPRIETOR") == "sole proprietor"


def test_a_job_searches_each_owner_name_once_paced_rated_and_cached(conn, fake):
    intel = [record(f"CY{i:018d}", f"INTEL INVEST {i}", "CY") for i in range(13)] + [
        record("US0000000000000INTEL", "INTEL CORPORATION", "US"),
        record("NL0000000000000INTEL", "Intel Corporation", "NL")]               # 15, as page[size] asks
    fake.names = {"INTEL": intel, "HITACHI": [record("JP00000000000HITACHI", "HITACHI, LTD.", "JP")]}
    before = measures.view(conn, "apple")
    j = run(conn)
    assert (j["state"], j["names_done"], j["names_total"], j["requests"], j["error"]) == ("done", 41, 41, 41, None)
    sent = fake.searched()
    assert len(sent) == len(set(sent)) == 41 and not any("," in s for s in sent)   # each name once; no comma ever
    assert all(r.headers["user-agent"] == gleif_api.USER_AGENT for _, r in fake.requests)
    times = [t for t, _ in fake.requests]
    assert all(b - a >= 1.0 for a, b in zip(times, times[1:]))                # at most 1 request a second
    with conn.cursor() as cur:
        cur.execute("SELECT lei, review_level, match_type FROM gleif_api_candidate WHERE customer_id = 'apple' "
                    "AND owner_name = 'INTEL' ORDER BY review_level, rank")
        kept = cur.fetchall()
    assert len(kept) == 10                                                     # 15 returned, 10 kept, best first
    assert [(k["lei"], k["review_level"], k["match_type"]) for k in kept[:2]] == [
        ("US0000000000000INTEL", L, "exact"), ("NL0000000000000INTEL", P, "exact")]
    # linked to the owner's sites like a file candidate; nothing confirmed automatically
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n, count(person_verdict) AS decided FROM gleif_match WHERE customer_id = 'apple'")
        assert cur.fetchone() == {"n": 9 * 10 + 1, "decided": 0}            # INTEL's 9 sites x 10, HITACHI's 1 site x 1
    listed = client.get("/api/network/candidates", params={"company": "apple"}).json()
    assert len(listed) == 11 and {c["source"] for c in listed} == {"api"} and {c["verdict"] for c in listed} == {None}
    assert measures.view(conn, "apple") == before                              # numbers unchanged
    # the cache: a second run sends nothing
    n = len(fake.requests)
    assert run(conn)["requests"] == 0 and len(fake.requests) == n
    assert gleif_api.job(conn, "apple")["to_search"] == 0


def test_a_429_is_retried(conn, fake):
    fake.fail = [429]                                                          # the first request is answered 429
    j = run(conn)
    assert (j["state"], j["names_done"]) == ("done", 41)
    assert fake.waits.count(2) == 1                                            # retried after 2 s
    assert len(fake.searched()) == 42                                          # 41 names, one of them twice


def test_gleif_unreachable_stops_the_job_and_a_new_run_resumes(conn, fake):
    fake.fail = [503, 503, 503]                                                # 3 tries of the first name
    j = run(conn)
    assert (j["state"], j["names_done"]) == ("failed", 0) and "503" in j["error"]
    j = run(conn)
    assert (j["state"], j["names_done"], j["error"]) == ("done", 41, None)


def test_parents_are_fetched_only_after_a_confirm(conn, fake):
    fake.names = {"INTEL": [record("US0000000000000INTEL", "INTEL CORPORATION", "US"),
                            record("NL0000000000000INTEL", "Intel Corporation", "NL")]}
    fake.parents = {"US0000000000000INTEL": {"ultimate-parent": record("US00000000000PARENT", "INTEL HOLDINGS", "US")}}
    run(conn)
    assert fake.parent_requests() == []
    listed = {c["lei"]: c for c in client.get("/api/network/candidates", params={"company": "apple"}).json()}
    us, nl = listed["US0000000000000INTEL"], listed["NL0000000000000INTEL"]
    client.put(f"/api/network/candidates/{nl['id']}/verdict", json={"verdict": "no"})
    client.put(f"/api/network/candidates/{us['id']}/verdict", json={"verdict": "yes"})
    g = client.get(f"/api/network/candidates/{us['id']}").json()
    assert (g["candidate"]["verdict"], g["parents"], g["parents_fetching"]) == ("yes", [], True)
    run(conn)                                                                  # the worker's next steps
    assert fake.parent_requests() == ["/api/v1/lei-records/US0000000000000INTEL/direct-parent",
                                      "/api/v1/lei-records/US0000000000000INTEL/ultimate-parent"]   # not for the rejected one
    g = client.get(f"/api/network/candidates/{us['id']}").json()
    assert ([(p["type"], p["parent_lei"], p["parent_name"]) for p in g["parents"]], g["parents_fetching"]) == \
        ([("top", "US00000000000PARENT", "INTEL HOLDINGS")], False)
    with conn.cursor() as cur:
        cur.execute("SELECT os_id FROM gleif_match WHERE customer_id = 'apple' AND lei = 'US0000000000000INTEL' LIMIT 1")
        os_id = cur.fetchone()["os_id"]
    [m] = client.get(f"/api/customers/apple/sites/{os_id}").json()["gleif"]["confirmed"]
    assert [p["parent_name"] for p in m["parents"]] == ["INTEL HOLDINGS"]      # the map's site panel
    n = len(fake.requests)
    run(conn)
    assert len(fake.requests) == n                                             # parents are cached: not fetched again


def test_adidas_and_nike_keep_their_file_candidates(conn, fake):
    before = {c: [x["id"] for x in network.candidates(conn, c)] for c in ("adidas", "nike")}
    assert client.post("/api/network/jobs/adidas").status_code == 400
    assert gleif_api.enqueue(conn, "nike") is None and not gleif_api.job(conn, "nike")["eligible"]
    run(conn, "apple")
    assert {c: [x["id"] for x in network.candidates(conn, c)] for c in ("adidas", "nike")} == before
    assert (len(before["adidas"]), len(before["nike"])) == (221, 345)


def test_load_this_company_queues_a_search(conn, fake):
    from app import loader
    raw = (loader.DEMO_DIR / "samsung.csv").read_bytes()
    up = client.post("/api/uploads", files={"file": ("samsung.csv", raw, "text/csv")}).json()
    lst = "Samsung [Public List] (Samsung 2021 Facility List)"
    r = client.post(f"/api/uploads/{up['upload_id']}/confirm", json={"name": "Job Check", "lists": [lst], "current_lists": [lst]})
    try:
        j = r.json()["gleif_job"]
        assert (j["state"], j["names_total"], j["to_search"], j["minutes"]) == ("queued", 102, 102, 2)
        assert client.get("/api/network/jobs/job-check").json()["state"] == "queued"
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM customer WHERE customer_id = 'job-check'")
        conn.commit()


def test_job_endpoint_before_a_search(fake):
    j = client.get("/api/network/jobs/apple").json()
    assert (j["state"], j["eligible"], j["names"], j["to_search"], j["minutes"]) == (None, True, 41, 41, 1)
    assert client.post("/api/network/jobs/nobody").status_code == 404
    json.dumps(j)                                                              # plain JSON
