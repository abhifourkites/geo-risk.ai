"""API routes and the two-step upload. One company's upload does not change another's rows."""
import csv
import io

from fastapi.testclient import TestClient

from app import loader
from app.main import app

client = TestClient(app)          # no lifespan: no demo seed on the main database, no GDACS call
SAMSUNG_LIST = "Samsung [Public List] (Samsung 2021 Facility List)"
DEMO = ("adidas", "nike", "apple", "samsung")


def snapshot(conn) -> dict:
    """Every stored row of the 4 demo companies, per table."""
    out = {}
    with conn.cursor() as cur:
        for table, cols in (("site", "os_id, name, country_code, ST_AsText(location), workers_est, list_names, warnings"),
                            ("site_owner", "os_id, owner_name"),
                            ("gleif_match", "os_id, lei, review_level, person_verdict")):
            cur.execute(f"SELECT customer_id, {cols} FROM {table} WHERE customer_id = ANY(%s) ORDER BY 1, 2, 3",
                        (list(DEMO),))
            out[table] = [tuple(r.values()) for r in cur.fetchall()]
    return out


def upload(raw: bytes, name="file.csv"):
    r = client.post("/api/uploads", files={"file": (name, raw, "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


def test_upload_lists_strings_with_site_counts():
    body = upload((loader.DEMO_DIR / "samsung.csv").read_bytes(), "samsung.csv")
    assert body["rows"] == 187
    assert len(body["lists"]) == 13                        # Appendix A, R1: 13 list strings in the Samsung file
    assert {"list": SAMSUNG_LIST, "sites": 187} in body["lists"]


def test_one_upload_changes_one_company_only(conn):
    before = snapshot(conn)
    full = (loader.DEMO_DIR / "samsung.csv").read_bytes()

    first = upload(full)
    r = client.post(f"/api/uploads/{first['upload_id']}/confirm",
                    json={"name": "Isolation Test", "lists": [SAMSUNG_LIST], "current_lists": [SAMSUNG_LIST]})
    assert r.status_code == 200, r.text
    assert (r.json()["customer_id"], r.json()["open_sites"]) == ("isolation-test", 187)
    assert snapshot(conn) == before

    # a second upload for the same company replaces its rows (not appended), and still touches no one else;
    # the file also carries a claim_* column, which is dropped
    rows = list(csv.DictReader(io.StringIO(full.decode("utf-8-sig"))))[:20]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=[*rows[0], "claim_contact_email"])
    w.writeheader()
    w.writerows({**row, "claim_contact_email": "someone@example.test"} for row in rows)
    second = upload(buf.getvalue().encode())
    r = client.post(f"/api/uploads/{second['upload_id']}/confirm",
                    json={"name": "Isolation Test", "lists": [SAMSUNG_LIST], "current_lists": [SAMSUNG_LIST]})
    assert r.status_code == 200, r.text
    expected = sum(SAMSUNG_LIST in row["contributor (list)"].split("|") and row["is_closed"] != "True" for row in rows)
    assert r.json()["open_sites"] == expected
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM site WHERE customer_id = 'isolation-test'")
        assert cur.fetchone()["n"] == expected
    assert snapshot(conn) == before


def test_confirm_needs_a_current_list_among_the_picked():
    up = upload((loader.DEMO_DIR / "samsung.csv").read_bytes())
    r = client.post(f"/api/uploads/{up['upload_id']}/confirm",
                    json={"name": "X", "lists": [SAMSUNG_LIST], "current_lists": ["not picked"]})
    assert r.status_code == 400


def test_upload_rejects_a_file_that_is_not_open_supply_hub():
    r = client.post("/api/uploads", files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")})
    assert r.status_code == 400


def test_routes():
    customers = {c["customer_id"]: c["open_sites"] for c in client.get("/api/customers").json()}
    assert {k: customers[k] for k in DEMO} == {"adidas": 766, "nike": 625, "apple": 749, "samsung": 187}
    assert client.get("/api/customers/adidas/view?high=5&watch=10").status_code == 400
    assert client.get("/api/customers/nobody/view").status_code == 404
    owner = client.get("/api/customers/adidas/owners/POU CHEN").json()      # multi-hop
    assert (len(owner["sites"]), owner["countries"], owner["all_in_one_country"]) == (9, ["CN", "ID", "MM", "VN"], False)
    site = client.get("/api/customers/adidas/sites/TR201909837HW3X").json()
    assert site["site"]["os_id"] == "TR201909837HW3X" and site["owners"]
    assert client.get("/api/customers/adidas/sites/NOPE").status_code == 404


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}
