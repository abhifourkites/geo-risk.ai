"""GLEIF API candidates (gleif_api.py) with a fake GLEIF (no network): core-name search, no commas sent,
the rating rules, at most 10 kept, 1 request a second, the cache, a 429 retry, parents only after a confirm."""
import asyncio
import json
import urllib.parse

import httpx
import pytest
from fastapi.testclient import TestClient

from app import gleif, gleif_api, hazards, loader, measures, network, rating
from app.main import app

client = TestClient(app)
L, P, U = gleif_api.LIKELY, gleif_api.POSSIBLE, gleif_api.UNLIKELY
REAL_CLIENT = httpx.AsyncClient


def record(lei, name, country, status="ACTIVE", reg="ISSUED", category="GENERAL", other_names=()):
    """A GLEIF lei-record, the fields gleif_api reads (shape as the live API returned it on 2 Oct 2026)."""
    return {"type": "lei-records", "id": lei, "attributes": {
        "lei": lei, "registration": {"status": reg},
        "entity": {"legalName": {"name": name, "language": "en"}, "legalAddress": {"country": country},
                   "status": status, "category": category,
                   "otherNames": [{"name": n, "language": "en", "type": "ALTERNATIVE_LANGUAGE_LEGAL_NAME"} for n in other_names]}}}


class FakeGleif:
    """Answers lei-records searches from `names` (core name -> records) and parent requests from `parents`
    (LEI -> {"direct-parent": record, ...}; missing: 404). `fail` = status codes to answer first."""

    def __init__(self, names=None, parents=None, fail=(), entities=None):
        self.names, self.parents, self.fail, self.entities = names or {}, parents or {}, list(fail), entities or {}
        self.requests: list[tuple[float, httpx.Request]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((gleif_api._now(), request))
        if self.fail:
            return httpx.Response(self.fail.pop(0), json={"errors": [{"status": "x"}]})
        path = request.url.path.removeprefix("/api/v1/lei-records")
        if not path:
            return httpx.Response(200, json={"data": self.names.get(request.url.params["filter[entity.legalName]"], [])})
        parts = path.strip("/").split("/")
        if len(parts) == 1:                                                    # one LEI's record
            rec = self.entities.get(parts[0])
            return httpx.Response(200, json={"data": rec}) if rec else httpx.Response(404, json={"errors": [{"status": "404"}]})
        lei, kind = parts
        parent = self.parents.get(lei, {}).get(kind)
        return httpx.Response(200, json={"data": parent}) if parent else httpx.Response(404, json={"errors": [{"status": "404"}]})

    def searched(self) -> list[str]:
        return [r.url.params["filter[entity.legalName]"] for _, r in self.requests if r.url.path.endswith("/lei-records")]

    def parent_requests(self) -> list[str]:
        return [r.url.path for _, r in self.requests if not r.url.path.endswith("/lei-records")]


def work(conn):
    """The worker's pending steps (parent names, parents, jobs), with the fake GLEIF."""
    async def go():
        async with gleif_api.client() as http:
            await gleif_api.run_until_idle(http)
    asyncio.run(go())


ACE_TURTLE, ACE_PARENT = "3358006WJQ5NKCOILG39", "9845008E3DZ3B8366596"   # its direct parent: no name in our GLEIF files


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
    # the slice file's saved verdicts confirm ACE TURTLE OMNI: its parent's name is fetched first; settle that, then start clean
    g.entities = {ACE_PARENT: record(ACE_PARENT, "AUGUST PURPLE SERVICES PRIVATE LIMITED", "IN")}
    work(conn)
    g.requests.clear()
    g.entities = {}
    yield g
    wipe()


def run(conn, customer="apple"):
    gleif_api.enqueue(conn, customer)

    async def go():
        async with gleif_api.client() as http:
            await gleif_api.run_until_idle(http)
    asyncio.run(go())
    return gleif_api.job(conn, customer)




def _confirm_ace_turtle(conn):
    [c] = [x for x in network.candidates(conn) if x["lei"] == ACE_TURTLE]
    assert client.put(f"/api/network/candidates/{c['id']}/verdict", json={"verdict": "yes"}).status_code == 200
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, os_id FROM gleif_match WHERE lei = %s AND person_verdict = 'yes' LIMIT 1", (ACE_TURTLE,))
        site = cur.fetchone()
    return c["id"], site


def _forget_ace_parent_name(conn):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM gleif_api_cache WHERE url = %s", (gleif.ENTITY_URL.format(lei=ACE_PARENT),))
    conn.commit()


def test_a_confirmed_parent_without_a_name_gets_it_from_gleif_once(conn, fake):
    _forget_ace_parent_name(conn)                                              # as before its first fetch
    fake.entities = {ACE_PARENT: record(ACE_PARENT, "AUGUST PURPLE SERVICES PRIVATE LIMITED", "IN")}   # as GLEIF named it live
    i, site = _confirm_ace_turtle(conn)
    g = client.get(f"/api/network/candidates/{i}").json()
    assert ([(p["parent_lei"], p["parent_name"], p["name_status"]) for p in g["parents"]], g["parents_fetching"]) == \
        ([(ACE_PARENT, None, "fetching")], True)
    work(conn)
    assert [r.url.path for _, r in fake.requests] == [f"/api/v1/lei-records/{ACE_PARENT}"]
    g = client.get(f"/api/network/candidates/{i}").json()
    assert ([(p["type"], p["parent_name"], p["name_status"]) for p in g["parents"]], g["parents_fetching"]) == \
        ([("direct", "AUGUST PURPLE SERVICES PRIVATE LIMITED", "known")], False)
    [m] = client.get(f"/api/customers/{site['customer_id']}/sites/{site['os_id']}").json()["gleif"]["confirmed"]
    assert [p["parent_name"] for p in m["parents"]] == ["AUGUST PURPLE SERVICES PRIVATE LIMITED"]   # the map's site panel
    work(conn)
    assert len(fake.requests) == 1                                             # cached: fetched once


def test_a_parent_name_that_cannot_be_fetched_says_so(conn, fake):
    _forget_ace_parent_name(conn)
    fake.fail = [503, 503, 503]                                                # 3 tries, then given up
    i, _ = _confirm_ace_turtle(conn)
    work(conn)
    g = client.get(f"/api/network/candidates/{i}").json()
    assert ([(p["parent_name"], p["name_status"]) for p in g["parents"]], g["parents_fetching"]) == ([(None, "not_available")], False)
    work(conn)
    assert len(fake.requests) == 3                                             # not tried again until the next start
    fake.entities = {ACE_PARENT: record(ACE_PARENT, "AUGUST PURPLE SERVICES PRIVATE LIMITED", "IN")}
    gleif_api.forget_failures(conn)                                            # what a start does
    work(conn)
    assert [p["parent_name"] for p in client.get(f"/api/network/candidates/{i}").json()["parents"]] == ["AUGUST PURPLE SERVICES PRIVATE LIMITED"]


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


@pytest.mark.parametrize("ours,countries,names,country,status,category,reg,expected", [
    ("INTEL", {"US", "IE"}, ["INTEL CORPORATION"], "US", "ACTIVE", "GENERAL", "ISSUED", L),   # equal after R4, site country, active
    ("INTEL", {"US", "IE"}, ["Intel Corporation"], "NL", "ACTIVE", "GENERAL", "ISSUED", P),   # equal name, another country
    ("INTEL", {"US", "IE"}, ["INTEL CORPORATION"], "US", "INACTIVE", "GENERAL", "ISSUED", P), # equal, same country, not active
    ("HITACHI", {"US"}, ["HITACHI AMERICA, LTD."], "US", "ACTIVE", "GENERAL", "ISSUED", P),    # a subsidiary: starts with our name
    ("AVERY DENNISON", {"BE"}, ["Avery Dennison België"], "BE", "ACTIVE", "GENERAL", "ISSUED", P),
    ("INTEL", {"US", "IE"}, ["INTEL INVEST"], "CY", "ACTIVE", "GENERAL", "ISSUED", U),        # the live "Intel" search's first result
    ("HITACHI", {"US"}, ["HITACHI AMERICA, LTD."], "JP", "ACTIVE", "GENERAL", "ISSUED", U),    # starts with, but another country
    ("INTEL", {"US"}, ["INTELLIGENT SYSTEMS INC"], "US", "ACTIVE", "GENERAL", "ISSUED", U),   # not as whole words
    ("BRANDIX ASIA PTE", {"MX"}, ["BRANDIX ASIA HOLDINGS PTE. LIMITED"], "SG", "ACTIVE", "GENERAL", "ISSUED", P),  # HOLDINGS: R4 word
    # GLEIF other names: the best match decides (file row 5: the legal name is Vietnamese)
    ("AVERY DENNISON RIS VIETNAM CO., LIMITED", {"VN"},
     ["CÔNG TY TNHH AVERY DENNISON RIS VIỆT NAM", "AVERY DENNISON RIS VIETNAM CO.,LIMITED"], "VN", "ACTIVE", "GENERAL", "ISSUED", L),
    ("AVERY DENNISON RIS VIETNAM CO., LIMITED", {"VN"},
     ["CÔNG TY TNHH AVERY DENNISON RIS VIỆT NAM"], "VN", "ACTIVE", "GENERAL", "ISSUED", U),  # the legal name alone
    # DE CV, SRL, S R L, PTE dropped for the comparison only (rows 3 and 13)
    ("VERTICAL KNITS", {"MX"}, ["VERTICAL KNITS SA DE CV"], "MX", "ACTIVE", "GENERAL", "ISSUED", L),
    ("L.I.M. SRL", {"IT"}, ["L.I.M. S.R.L."], "IT", "ACTIVE", "GENERAL", "ISSUED", L),
    ("BRANDIX ASIA PTE", {"SG"}, ["BRANDIX ASIA PTE. LTD."], "SG", "ACTIVE", "GENERAL", "ISSUED", L),
    # the cap: a sole proprietor, a fund or a lapsed registration is at most possible (rows 173, 223, 289)
    ("ARYAN APPARELS", {"IN"}, ["ARYAN APPARELS"], "IN", "ACTIVE", "SOLE_PROPRIETOR", "LAPSED", P),
    ("WINTEX EXPORTS", {"IN"}, ["WINTEX EXPORTS"], "IN", "ACTIVE", "SOLE_PROPRIETOR", "ISSUED", P),
    ("X", {"IN"}, ["X"], "IN", "ACTIVE", "FUND", "ISSUED", P),
    ("X", {"IN"}, ["X"], "IN", "ACTIVE", "GENERAL", "LAPSED", P),
    ("X", {"IN"}, ["X"], "US", "ACTIVE", "FUND", "ISSUED", P),              # the cap never lowers possible or unlikely
])
def test_rating_rules(ours, countries, names, country, status, category, reg, expected):
    assert rating.rate(ours, countries, names, country, status, category, reg) == expected


def test_the_comparison_drops_words_r4_keeps_but_r4_is_unchanged():
    from app import clean
    assert rating.compare_name("VERTICAL KNITS SA DE CV") == "VERTICAL KNITS"
    assert rating.compare_name("L.I.M. (LAVORAZONI INDUSTRIALI METALLICHE) S.R.L.") == "L I M LAVORAZONI INDUSTRIALI METALLICHE"
    assert rating.compare_name("DE LA RUE") == "DE LA RUE"                    # DE alone stays
    assert clean.clean_owner("VERTICAL KNITS SA DE CV") == "VERTICAL KNITS DE CV"   # R4 as before


def test_the_file_candidates_use_the_rules_and_keep_the_files_level():
    rows = {r["LEI"]: r for r in gleif.file_rows()}
    for lei in ("549300YDGYNJ5OSNWF92", "213800TIMLY8NHYC2I61", "8156005B22B0857C7357"):   # Paxar, Coats Rejo, Racing Force
        assert (rows[lei]["review_level"], rows[lei]["file_review_level"]) == (L, "1 likely - confirm")
    assert [(r["review_level"], r["file_review_level"][0]) for r in gleif.file_rows() if r["our_names"] == "ARYAN APPARELS"] == \
        [(L, "2"), (P, "3")]                                               # one likely LEI for ARYAN APPARELS, not two


def test_flags():
    assert rating.flags("ACTIVE", "ISSUED", "GENERAL") == ""
    assert rating.flags("INACTIVE", "LAPSED", "FUND") == "not active; registration lapsed; fund"
    assert rating.flags("ACTIVE", "ISSUED", "SOLE_PROPRIETOR") == "sole proprietor"


def test_api_results_are_rated_on_other_names_too(conn, fake):
    """entity.otherNames: an English other name matches although the legal name is in Chinese."""
    fake.names = {"WISTRON": [record("TW00000000000WISTRN", "緯創資通股份有限公司", "CN", other_names=["Wistron Corporation"])]}
    run(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT review_level, match_type, matched_name, name_field FROM gleif_api_candidate "
                    "WHERE customer_id = 'apple' AND owner_name = 'WISTRON'")
        assert cur.fetchone() == {"review_level": L, "match_type": "exact", "matched_name": "Wistron Corporation",
                                  "name_field": "OtherEntityNames"}


def test_candidates_rated_with_older_rules_are_rated_again_from_the_cache(conn, fake):
    fake.names = {"WISTRON": [record("TW00000000000WISTRN", "緯創資通股份有限公司", "CN", other_names=["Wistron Corporation"])]}
    run(conn)
    with conn.cursor() as cur:                                             # as the first rules left it: legal name only
        cur.execute("UPDATE gleif_api_candidate SET review_level = %s WHERE owner_name = 'WISTRON'", (U,))
        cur.execute("UPDATE gleif_api_name SET rules = 1")
    conn.commit()
    n = len(fake.requests)
    assert gleif_api.rerate_all(conn) == 41 and len(fake.requests) == n      # every name, no request
    with conn.cursor() as cur:
        cur.execute("SELECT review_level FROM gleif_api_candidate WHERE owner_name = 'WISTRON'")
        assert cur.fetchone()["review_level"] == L
    assert gleif_api.rerate_all(conn) == 0                                 # nothing left to rate again


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


def test_a_shared_candidate_has_one_verdict_and_each_companys_own_rating(conn, fake):
    """Apple and Samsung both have the owner INTEL: one candidate per name and LEI, one verdict for both, rated with
    each company's own site countries (likely for a company with a site in the LEI's country, else possible)."""
    fake.names = {"INTEL": [record("IE0000000000000INTEL", "INTEL CORPORATION", "IE")]}
    run(conn, "apple")
    run(conn, "samsung")
    with conn.cursor() as cur:
        cur.execute("""SELECT o.customer_id, bool_or(s.country_code = 'IE') AS ie FROM site_owner o JOIN site s USING (customer_id, os_id)
                       WHERE o.owner_name = 'INTEL' AND o.customer_id IN ('apple', 'samsung') GROUP BY 1 ORDER BY 1""")
        has_ie = {r["customer_id"]: r["ie"] for r in cur.fetchall()}
    seen = {c: [x for x in client.get("/api/network/candidates", params={"company": c}).json() if x["our_names"] == "INTEL"]
            for c in ("apple", "samsung")}
    [a], [s] = seen["apple"], seen["samsung"]
    assert a["id"] == s["id"] and (a["companies"], s["companies"], a["shared"], s["shared"]) == (["Apple"], ["Samsung"], True, True)
    assert (a["level"], s["level"]) == tuple("1" if has_ie[c] else "2" for c in ("apple", "samsung"))
    client.put(f"/api/network/candidates/{a['id']}/verdict", json={"verdict": "yes"})
    assert [x["verdict"] for x in client.get("/api/network/candidates", params={"company": "samsung"}).json()
            if x["our_names"] == "INTEL"] == ["yes"]


def test_saved_verdicts_of_api_candidates_apply_after_a_search(conn, fake):
    """data/reference/gleif_api_verdicts.csv holds (apple, HENKEL AG AND KGAA, 549300VZCL1HTH4O4Y49, yes): once Apple's
    search finds that LEI for that owner name, it is confirmed, from the file."""
    henkel = "549300VZCL1HTH4O4Y49"
    assert gleif.api_file_verdicts()[("apple", "HENKEL AG AND KGAA", henkel)] == "yes"
    fake.names = {"HENKEL AG AND KGAA": [record(henkel, "Henkel AG & Co. KGaA", "DE")]}
    run(conn)
    [c] = [x for x in client.get("/api/network/candidates", params={"company": "apple"}).json() if x["lei"] == henkel]
    assert (c["our_names"], c["level"], c["verdict"], c["verdict_from"]) == ("HENKEL AG AND KGAA", "1", "yes", "file")
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n, count(*) FILTER (WHERE person_verdict = 'yes') AS yes FROM gleif_match "
                    "WHERE customer_id = 'apple' AND lei = %s", (henkel,))
        assert cur.fetchone() == {"n": 4, "yes": 4}                            # HENKEL's 4 Apple sites
    assert f"/api/v1/lei-records/{henkel}/ultimate-parent" in fake.parent_requests()   # its parents are fetched, as after a confirm


HENKEL, AMAZON_2026 = "549300VZCL1HTH4O4Y49", "Amazon.com, Inc. (Amazon Facility List 2026)"
# from the files: the owner HENKEL AG AND KGAA has 4 of Apple's sites (data/demo/apple-osh.csv) and 2 of Amazon's
# (data/demo/amazon.csv, its 2026 list)
HENKEL_SITES = {"apple": ["CN202229760YWY7", "DE20222979W1ZAG", "US20222979BFJ7W", "US2023347AKDGD4"],
                "amazon-com-inc": ["US2022297DHF3XD", "US2022297J5WS0C"]}


@pytest.fixture
def henkel(conn, fake):
    """Amazon loaded as the upload page pre-fills it (its 2026 list), and Apple's and Amazon's searches run with a
    GLEIF that knows only HENKEL AG AND KGAA: one candidate for both (the same owner name and LEI)."""
    raw = (loader.DEMO_DIR / "amazon.csv").read_bytes()
    loader.load_customer(conn, "amazon-com-inc", "Amazon.com, Inc.", raw, [AMAZON_2026], [AMAZON_2026])
    conn.commit()
    fake.names = {"HENKEL AG AND KGAA": [record(HENKEL, "Henkel AG & Co. KGaA", "DE")]}
    run(conn, "apple")
    run(conn, "amazon-com-inc")
    yield
    with conn.cursor() as cur:
        cur.execute("DELETE FROM customer WHERE customer_id = 'amazon-com-inc'")
    conn.commit()


def _henkel(company: str) -> tuple[dict, dict]:
    [c] = [x for x in client.get("/api/network/candidates", params={"company": company}).json() if x["lei"] == HENKEL]
    return c, client.get(f"/api/network/candidates/{c['id']}", params={"company": company}).json()


def test_apples_henkel_row_and_graph_have_only_apples_sites(henkel):
    """Apple's page: HENKEL AG AND KGAA has Apple's 4 sites, and the graph has only Apple under "Your company"
    (it drew Amazon.com, Inc. too, and the row said 6 sites); Amazon is not named in the row or the graph."""
    c, g = _henkel("apple")
    assert (c["our_names"], c["sites"], c["countries"], c["companies"], c["company_ids"], c["shared"]) == \
        ("HENKEL AG AND KGAA", 4, ["CN", "DE", "US"], ["Apple"], ["apple"], True)
    assert g["companies"] == [{"customer_id": "apple", "name": "Apple"}]
    assert sorted(s["os_id"] for s in g["sites"]) == HENKEL_SITES["apple"] and {tuple(s["companies"]) for s in g["sites"]} == {("apple",)}
    assert "amazon" not in json.dumps([c, g]).lower()
    lines = client.get("/api/network/verdicts.csv", params={"company": "apple"}).text.splitlines()    # its download
    assert len(lines) == 2 and lines[1].startswith("owner,HENKEL AG AND KGAA,549300VZCL1HTH4O4Y49,")


def test_amazons_henkel_row_has_only_amazons_sites_and_one_verdict_with_apple(henkel):
    a, _ = _henkel("apple")
    z, g = _henkel("amazon-com-inc")
    assert (z["sites"], z["countries"], z["companies"], z["company_ids"], z["shared"]) == \
        (2, ["US"], ["Amazon.com, Inc."], ["amazon-com-inc"], True)
    assert g["companies"] == [{"customer_id": "amazon-com-inc", "name": "Amazon.com, Inc."}]
    assert sorted(s["os_id"] for s in g["sites"]) == HENKEL_SITES["amazon-com-inc"]
    assert "apple" not in json.dumps([z, g]).lower()
    # one verdict for the GLEIF company: saved for both today; rejected on Apple's page, it is rejected on Amazon's
    assert (a["id"], a["verdict"]) == (z["id"], z["verdict"]) and z["verdict"] == "yes"
    r = client.put(f"/api/network/candidates/{a['id']}/verdict", params={"company": "apple"}, json={"verdict": "no"})
    assert r.status_code == 200 and (r.json()["verdict"], r.json()["sites"], r.json()["companies"]) == ("no", 4, ["Apple"])
    assert (_henkel("amazon-com-inc")[0]["verdict"], _henkel("amazon-com-inc")[0]["verdict_from"]) == ("no", "page")


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
