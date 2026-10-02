"""Upload page pre-fill (contributors.py). The page ticks a company's current lists only, and marks them current.
On each demo file these equal the seed file's picks (data/demo/demo_companies.json), and loading with them gives
the same numbers as the seed."""
import json

import pytest

from app import contributors, loader, measures

DEMO = {c["customer_id"]: c for c in json.loads((loader.DEMO_DIR / "demo_companies.json").read_text())}
# Amazon's own list strings in data/demo/amazon.csv (an Open Supply Hub download for Amazon, 2 Oct 2026:
# 3,798 rows, every one names Amazon.com, Inc.), most sites first
AMAZON = ["Amazon.com, Inc. (Amazon Facility List 2024)", "Amazon.com, Inc. (Amazon Facility List 2023)",
          "Amazon.com, Inc. (Amazon Facility List 2022)", "Amazon.com, Inc. (Amazon Facility List 2026)", "Amazon.com, Inc."]


def suggest(file: str) -> dict:
    return contributors.suggest(loader.read_rows((loader.DEMO_DIR / file).read_bytes()))


def picked(s: dict, name: str) -> dict:
    return next(c for c in s["contributors"] if c["name"] == name)


def test_contributor_name_is_the_string_without_public_list_and_list_name():
    parse = contributors.parse
    assert parse("Amazon.com, Inc. (Amazon Facility List 2026)") == ("Amazon.com, Inc.", "Amazon Facility List 2026")
    assert parse("Amazon.com, Inc.") == ("Amazon.com, Inc.", None)
    assert parse("Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)") == \
        ("Nike", "Nike Inc. Brand(s) February 2024 Facility List")
    assert parse("US Food & Drug Administration (FDA) [Public List]") == ("US Food & Drug Administration (FDA)", None)
    assert parse("US Environmental Protection Agency (EPA) [Public List] (Toxics Release Inventory (TRI) Program (2021) "
                 "Production Locations - 2)") == \
        ("US Environmental Protection Agency (EPA)", "Toxics Release Inventory (TRI) Program (2021) Production Locations - 2")
    # facilities.csv names SLCP alone and with a list: one contributor, not two
    slcp = {"Social & Labor Convergence Program (SLCP)",
            "Social & Labor Convergence Program (SLCP) (Social & Labor Convergence Program List 2025)"}
    whole = contributors.whole_names(slcp)
    assert {parse(s, whole) for s in slcp} == {("Social & Labor Convergence Program (SLCP)", None),
                                               ("Social & Labor Convergence Program (SLCP)", "Social & Labor Convergence Program List 2025")}


def test_anonymous_types_and_claimed_entries_are_hidden():
    for s in ("A Brand / Retailer", "An Other", "A Facility / Factory / Manufacturing Group / Supplier / Vendor",
              "Pou Chen Group (Claimed)", "CHENG LOONG (GWANGTUNG) PAPER CO.,LTD. (Claimed)"):
        assert contributors.hidden(s), s
    for s in ("Amazon.com, Inc.", "adidas (OSHub-Data-Template-adidas-Primary-Jan 2026)", "Worldly", "Other"):
        assert not contributors.hidden(s), s


def test_current_lists_hold_the_latest_year_of_the_list_name():
    current = contributors.current_lists
    assert current(AMAZON) == ["Amazon.com, Inc. (Amazon Facility List 2026)"]       # Amazon: only its 2026 list
    # the files' other 4-digit numbers are not years: a contributor name, s.Oliver list codes, a fiscal year
    assert current(["AZZAS 2154 (OFICINA Facility List Dec 2024)", "AZZAS 2154 (AREZZO Suppliers Facility List June 2025)"]) == \
        ["AZZAS 2154 (AREZZO Suppliers Facility List June 2025)"]
    oliver = ["s.Oliver Group [Public List] (s.Oliver Group 0323 Aug 2023 Facility List)",
              "s.Oliver Group [Public List] (s.Oliver Group 1122 Aug 2023 Facility List)"]
    assert current(oliver) == oliver
    assert current(["INTERSPORT (INTERSPORT International FY2526 Q4 T1)", "HeatWatch"]) == []    # no year: not current


def test_adidas_and_nike_file_shows_suggestions():
    s = suggest("facilities.csv")
    assert s["preselect"] is None                      # no contributor is on every row: a person picks
    assert [(c["name"], c["rows"]) for c in s["contributors"]] == [
        ("Nike", 868), ("Wikirate International e.V.", 795), ("adidas", 766),
        ("Social & Labor Convergence Program (SLCP)", 691), ("Partnership for Sustainable Textiles (PST)", 644)]
    assert "A Brand / Retailer" in s["hidden"] and "Pou Chen Group (Claimed)" in s["hidden"]
    adidas, nike = picked(s, "adidas"), picked(s, "Nike")
    assert adidas["current_lists"] == DEMO["adidas"]["lists"] == DEMO["adidas"]["current_lists"]   # its 3 Jan/Apr 2026 lists
    assert nike["current_lists"] == DEMO["nike"]["lists"] == DEMO["nike"]["current_lists"]         # only February 2024
    # Nike's 3 older lists are not current, so not ticked; they are returned so the page can show them first
    assert set(nike["lists"]) - set(nike["current_lists"]) == {
        "Nike [Public List] (Nike Inc. Brand(s) August 2023 Facility List)",
        "Nike [Public List] (Nike Inc. February 2022 Facility List)",
        "Nike [Public List] (Nike Facility List November 2020)"}


def test_the_amazon_file_preselects_amazon_and_its_2026_list():
    import datetime
    rows = loader.read_rows((loader.DEMO_DIR / "amazon.csv").read_bytes())
    s = contributors.suggest(rows)
    c = picked(s, "Amazon.com, Inc.")
    assert (s["preselect"], c["share"], c["lists"], c["current_lists"]) == ("Amazon.com, Inc.", 1.0, AMAZON, [AMAZON[3]])
    assert len(loader.prepare_sites(rows, c["current_lists"], c["current_lists"], datetime.date(2026, 10, 2))) == 1732
    assert not any(k.startswith("claim_") for k in rows[0])


@pytest.mark.parametrize("cid", ["apple", "samsung"])
def test_a_one_company_file_preselects_it(cid):
    d = DEMO[cid]
    s = suggest(d["file"])
    assert s["preselect"] == d["name"]
    c = picked(s, d["name"])
    assert c["share"] == 1.0 and c["current_lists"] == d["lists"] == d["current_lists"]


def _same_order(v: dict) -> dict:
    """Sites come back in no fixed order (also when the seed's own picks are loaded again), so they are compared
    sorted. Countries are compared as returned: equal shares are ordered by name."""
    return {**v, "sites": sorted(v["sites"], key=lambda x: x["os_id"])}


def test_loading_with_the_pre_filled_picks_gives_the_seed_numbers(conn):
    for cid, d in DEMO.items():
        raw = (loader.DEMO_DIR / d["file"]).read_bytes()
        c = picked(contributors.suggest(loader.read_rows(raw)), d["name"])
        test_id = f"prefill-{cid}"
        loader.load_customer(conn, test_id, d["name"], raw, c["current_lists"], c["current_lists"])   # as the page sends them
        try:
            seed, new = measures.view(conn, cid), measures.view(conn, test_id)
            for v in (seed, new):
                v.pop("customer")
            seed_lists, new_lists = seed.pop("lists"), new.pop("lists")
            assert _same_order(new) == _same_order(seed), cid
            assert new_lists == seed_lists == d["current_lists"], cid
        finally:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM customer WHERE customer_id = %s", (test_id,))
            conn.commit()
