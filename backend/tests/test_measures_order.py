"""Countries and owners come back in the same order on every load: by share, equal shares by name."""
import pytest

from app import measures

DEMO = ("adidas", "nike", "apple", "samsung")


def test_equal_country_shares_are_ordered_by_name(conn):
    # 2 sites in Switzerland, 2 in Germany, 1 in Vietnam: Germany and Switzerland have equal shares (40%).
    # By name Germany comes first; by code (CH, DE) Switzerland would.
    sites = [("t1", "CH"), ("t2", "CH"), ("t3", "DE"), ("t4", "DE"), ("t5", "VN")]
    with conn.cursor() as cur:
        cur.execute("INSERT INTO customer (customer_id, name) VALUES ('tie-test', 'Tie test')")
        cur.executemany("INSERT INTO site (customer_id, os_id, name, country_code) VALUES ('tie-test', %s, %s, %s)",
                        [(os_id, os_id, code) for os_id, code in sites])
        try:
            got = measures.country_shares(cur, "tie-test", "sites", 10, 5)
            assert [(c["country_code"], c["share"]) for c in got] == [("DE", 0.4), ("CH", 0.4), ("VN", 0.2)]
        finally:
            conn.rollback()


@pytest.mark.parametrize("customer", DEMO)
def test_demo_countries_with_equal_shares_are_in_name_order(conn, customer):
    countries = measures.view(conn, customer)["countries"]
    keys = [(-c["share"], measures.country_name(c["country_code"])) for c in countries]
    assert keys == sorted(keys)
    if customer == "apple":       # a case that came back in a different order before: 4 countries with 4 sites each
        assert [measures.country_name(c["country_code"]) for c in countries if c["sites"] == 4] == \
            ["France", "Indonesia", "Netherlands", "United Kingdom"]


@pytest.mark.parametrize("customer", DEMO)
def test_owners_with_equal_shares_are_in_a_fixed_order(conn, customer):
    owners = measures.view(conn, customer)["owners"]["all"]
    keys = [(-o["share"], -o["sites"], o["owner"]) for o in owners]
    assert keys == sorted(keys)
