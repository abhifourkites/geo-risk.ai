"""GLEIF (R7, build step 4): candidates re-linked by name, only for the companies in our_brands."""
import csv

from app import gleif, measures


def test_likely_candidates_parents_and_verdicts(conn):
    with conn.cursor() as cur:
        # the written rules (rating.py) rate the file's candidates too; the file's own level is kept for reference
        for column, likely, with_parent in (("review_level", 32, 5), ("file_review_level", 30, 3)):
            cur.execute(f"SELECT count(DISTINCT lei) AS n FROM gleif_match WHERE {column} LIKE '1%'")
            assert cur.fetchone()["n"] == likely, column
            cur.execute(f"""SELECT count(DISTINCT m.lei) AS n FROM gleif_match m
                            JOIN gleif_parent p USING (lei) WHERE m.{column} LIKE '1%'""")
            assert cur.fetchone()["n"] == with_parent, column
        # confirmed: only the 5 verdicts saved in the slice file (adidas 4, Nike 1)
        cur.execute("SELECT customer_id, count(DISTINCT lei) AS n FROM gleif_match WHERE person_verdict = 'yes' GROUP BY 1 ORDER BY 1")
        assert {r["customer_id"]: r["n"] for r in cur.fetchall()} == {"adidas": 4, "nike": 1}


def test_no_candidates_for_apple_and_samsung(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, count(*) AS n FROM gleif_match GROUP BY 1")
        counts = {r["customer_id"]: r["n"] for r in cur.fetchall()}
    assert "apple" not in counts and "samsung" not in counts
    assert counts["adidas"] > 0 and counts["nike"] > 0


def test_no_parent_is_shown_without_a_verdict(conn):
    with conn.cursor() as cur:
        cur.execute("""SELECT DISTINCT m.customer_id, m.os_id, m.lei, m.person_verdict FROM gleif_match m JOIN gleif_parent p USING (lei)
                       WHERE m.review_level LIKE '1%'""")
        rows = cur.fetchall()
    assert rows and {r["person_verdict"] for r in rows} == {None, "yes"}
    for r in rows:
        d = measures.site_detail(conn, r["customer_id"], r["os_id"])
        assert d["gleif"]["candidates"] >= 1
        shown = {m["lei"] for m in d["gleif"]["confirmed"]}
        assert (r["lei"] in shown) == (r["person_verdict"] == "yes")     # a parent only after a yes


def test_known_parent_names(conn):
    with conn.cursor() as cur:
        # names as written in data/reference/gleif_parents_checked.csv (None: a parent whose name is not in it)
        for column, names in (("file_review_level", ["AVERY DENNISON CORPORATION", "COATS GROUP PLC", "SAYE S.P.A."]),
                              ("review_level", ["AVERY DENNISON CORPORATION", "COATS GROUP PLC", "SAYE S.P.A.", None])):
            cur.execute(f"""SELECT DISTINCT p.parent_name FROM gleif_match m JOIN gleif_parent p USING (lei)
                            WHERE m.{column} LIKE '1%' ORDER BY 1""")
            assert [r["parent_name"] for r in cur.fetchall()] == names, column


def test_a_yes_verdict_in_the_csv_shows_the_parent(conn, tmp_path, monkeypatch):
    """The verdict is edited in the slice CSV and read on the next start (gleif.refresh_all)."""
    with conn.cursor() as cur:
        cur.execute("""SELECT DISTINCT m.lei FROM gleif_match m JOIN gleif_parent p USING (lei)
                       WHERE m.review_level LIKE '1%' AND p.parent_name = 'COATS GROUP PLC'""")
        [lei] = [r["lei"] for r in cur.fetchall()]
    rows = gleif._read(gleif.SLICE)
    for r in rows:
        if r["LEI"] == lei:
            r[gleif.VERDICT_COLUMN] = "yes"
    edited = tmp_path / "slice.csv"
    with open(edited, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    monkeypatch.setattr(gleif, "SLICE", edited)
    try:
        gleif.refresh_all(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT customer_id, os_id FROM gleif_match WHERE lei = %s AND person_verdict = 'yes'", (lei,))
            confirmed = cur.fetchall()
        assert confirmed
        d = measures.site_detail(conn, confirmed[0]["customer_id"], confirmed[0]["os_id"])
        [match] = [m for m in d["gleif"]["confirmed"] if m["lei"] == lei]
        assert {p["parent_name"] for p in match["parents"]} == {"COATS GROUP PLC"}
    finally:
        monkeypatch.undo()
        gleif.refresh_all(conn)                              # back to the committed file: no verdicts
