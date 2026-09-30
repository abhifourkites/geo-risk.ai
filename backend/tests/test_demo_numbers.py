"""ARCHITECTURE.md section 8, from the committed demo data. The live hazard row (5 / 3 / 0 / 0, 30 Sep 2026)
and certificate warning counts (they depend on the run date) are deliberately not tested here."""
import pytest

from app import measures

DEMO = {
    # customer: open sites, basis, largest country (code, % 1 dp), countries at High
    "adidas": (766, "workers", ("VN", 31.5), 3),
    "nike": (625, "workers", ("VN", 40.6), 3),
    "apple": (749, "sites", ("CN", 45.9), 2),
    "samsung": (187, "sites", ("KR", 31.0), 4),
}


@pytest.mark.parametrize("customer", DEMO)
def test_section_8_numbers(conn, customer):
    open_sites, basis, (code, share), at_high = DEMO[customer]
    v = measures.view(conn, customer)
    assert v["coverage"]["open_sites"] == open_sites
    assert v["coverage"]["basis"] == basis
    top = v["countries"][0]
    assert (top["country_code"], round(top["share"] * 100, 1)) == (code, share)
    assert sum(c["level"] == "High" for c in v["countries"]) == at_high


def test_largest_owner_on_the_share_basis(conn):
    top = {c: measures.view(conn, c)["owners"]["top"][0] for c in DEMO}
    assert (top["adidas"]["owner"], round(top["adidas"]["share"] * 100, 1)) == ("POU CHEN", 7.4)
    assert (top["nike"]["owner"], round(top["nike"]["share"] * 100, 1)) == ("FENG TAY", 9.3)
    assert (top["apple"]["owner"], top["apple"]["sites"]) == ("INTEL", 9)
    assert (top["samsung"]["owner"], top["samsung"]["sites"]) == ("HITACHI", 9)
    assert top["adidas"]["level"] == top["nike"]["level"] == "Watch"


def test_every_number_has_its_base(conn):
    cov = measures.view(conn, "apple")["coverage"]
    for key in ("workers_known", "owner_known", "location_known"):
        assert set(cov[key]) == {"known", "of"} and cov[key]["of"] == 749
    assert cov["owner_known"]["known"] == 66


def test_thresholds_are_request_parameters(conn):
    # Samsung on the site basis: KR 31.0, US 14.4, VN 13.9, CN 12.8, JP 7.5, SG 5.3 (percent)
    assert sum(c["level"] == "High" for c in measures.view(conn, "samsung", high=14, watch=5)["countries"]) == 2
    assert sum(c["level"] == "Watch" for c in measures.view(conn, "samsung", high=14, watch=5)["countries"]) == 4


def test_samsung_sentence_follows_appendix_c3(conn, hazard_status):
    hazard_status.update(state="ok")
    assert measures.view(conn, "samsung")["sentence"] == (
        "4 countries at High (KR, US, VN, CN) and 2 at Watch by share of sites (workers known for 4 of 187); "
        "owner known for 187 of 187 sites; no sites inside current hazard areas.")


def test_no_stored_table_has_a_claim_column(conn):
    with conn.cursor() as cur:
        cur.execute("""SELECT table_name, column_name FROM information_schema.columns
                       WHERE table_schema = 'public' AND column_name ILIKE 'claim%'""")
        assert cur.fetchall() == []
