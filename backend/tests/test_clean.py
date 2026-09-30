"""Load and clean rules R2 and R4 on small hand-made values, and dropping claim_* columns."""
import datetime

from app import clean, loader


def test_workers_median_with_range_midpoint():
    assert clean.workers("100|200-400|500") == 300          # values 100, 300, 500
    assert clean.workers("1000") == 1000
    assert clean.workers("") is None


def test_owner_name_cleaning():
    assert clean.clean_owner("Pou Chen Group Co., Ltd.") == "POU CHEN"
    assert clean.clean_owner("Smith & Sons Pvt. Ltd") == "SMITH AND SONS"
    assert clean.clean_owner("株式会社日立製作所") == "株式会社日立製作所"      # other scripts are kept


def test_owners_self_name_and_placeholders():
    # a self-named owner is kept when it is the site's only owner, dropped when there is another owner
    assert clean.owners("Hitachi Ltd", "Hitachi, Ltd.") == ["HITACHI"]
    assert clean.owners("Hitachi Ltd", "Hitachi|Other Holdings") == ["OTHER"]
    assert clean.owners("Some Site", "N/A|No Group") == []
    # spellings are never merged
    assert clean.owners("X", "Pou Chen|Pouchen") == ["POU CHEN", "POUCHEN"]


def test_claim_columns_are_dropped_when_read():
    raw = "os_id,name,claim_contact_person,claim_email,contributor (list)\nA1,Site,Jane,j@x.test,L1\n".encode()
    rows = loader.read_rows(raw)
    assert rows and not any(k.startswith("claim_") for k in rows[0])


def test_open_site_and_warnings():
    rows = [
        {"os_id": "A", "name": "a", "contributor (list)": "L1", "is_closed": "False", "lat": "1", "lng": "2",
         "country_code": "VN", "parent_company": "P|Q", "number_of_workers": "10"},
        {"os_id": "B", "name": "b", "contributor (list)": "L1", "is_closed": "True", "lat": "1", "lng": "2",
         "country_code": "VN", "parent_company": "", "number_of_workers": ""},
        {"os_id": "C", "name": "c", "contributor (list)": "OLD", "is_closed": "False", "lat": "3", "lng": "4",
         "country_code": "VN", "parent_company": "", "number_of_workers": ""},
    ]
    sites = loader.prepare_sites(rows, ["L1", "OLD"], ["L1"], datetime.date(2026, 9, 30))
    assert [s["os_id"] for s in sites] == ["A"]              # B is closed; C is only on a list that is not current
    assert "same_coordinates" in sites[0]["warnings"]        # same point as closed row B of the same file
    assert "owner_conflict" in sites[0]["warnings"]


def test_certificate_warnings_with_a_fixed_as_of_date():
    """R3 certificates on hand-made dates (the demo counts depend on the run date, so they are not tested)."""
    as_of = datetime.date(2026, 9, 30)
    row = {"wrap_certification.expiration_date": "2026-09-29|2025-01-01",
           "amfori_compliance_status.bsci_audit.expiration_date": "2025-01-01|2026-10-01",   # latest is not expired
           "slcp_assessment.most_recent_assessment_date": "2024-09-29"}
    assert clean.certificate_warnings(row, as_of) == ["wrap_expired", "slcp_older_than_2y"]
    assert clean.certificate_warnings({}, as_of) == []                  # only where those dates exist
    assert clean.certificate_warnings({"slcp_assessment.most_recent_assessment_date": "2024-09-30"}, as_of) == []
