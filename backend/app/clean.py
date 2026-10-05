"""Cleaning rules R2, R3 and R4, each stated in the docstring of the function that applies it (owner names, R4,
are also summarised in docs/RULES.md).

The same rules are checked against the reference file by scripts/verify_inputs.py.
"""
import datetime
import re
import statistics

LEGAL_WORDS = {"CO", "COMPANY", "CORP", "CORPORATION", "GMBH", "GROUP", "HOLDING", "HOLDINGS", "INC", "JSC",
               "LIMITED", "LLC", "LTD", "PLC", "PRIVATE", "PT", "PVT", "SA"}
PLACEHOLDER = re.compile(r"^(NO GROUP( \w+)?|N A|NA|NULL)$")   # 'NO GROUP (AP)', 'N/A', 'NA', 'null' (any case)


def split_pipe(s: str | None) -> list[str]:
    return [p.strip() for p in (s or "").split("|") if p.strip()]


def basic(s: str | None) -> str:
    """R4 steps 1-4: upper case, & -> AND, punctuation -> space, collapse spaces (any Unicode space).
    Letters of every script are kept."""
    return " ".join(re.sub(r"[^\w\s]", " ", (s or "").upper().replace("&", " AND ")).split())


def clean_owner(s: str | None) -> str:
    """R4 step 5: also remove the legal-form words (only as separate words)."""
    return " ".join(w for w in basic(s).split() if w not in LEGAL_WORDS)


def owners(site_name: str, parent_company: str) -> list[str]:
    """R4 step 6: drop placeholders; drop an owner equal to the site's own name ONLY when the site
    has another owner name. Different spellings are never merged."""
    seen: list[str] = []
    for value in split_pipe(parent_company):
        if PLACEHOLDER.match(basic(value)):      # tested before legal words are removed
            continue
        name = clean_owner(value)
        if name and name not in seen:
            seen.append(name)
    own = clean_owner(site_name)
    others = [n for n in seen if n != own]
    return others if others else seen


def _worker_value(token: str) -> float | None:
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", token)
    if m:
        return (int(m.group(1)) + int(m.group(2))) / 2
    return float(token) if re.fullmatch(r"\d+", token) else None


def workers(number_of_workers: str) -> float | None:
    """R2: each value is a whole number, or the midpoint of a range 'a-b'; the estimate is the median
    of all values, duplicates kept. A value that is neither is skipped. None = unknown."""
    values = [v for v in (_worker_value(t) for t in split_pipe(number_of_workers)) if v is not None]
    return float(statistics.median(values)) if values else None


def _latest_date(s: str) -> datetime.date | None:
    dates = []
    for token in split_pipe(s):
        try:
            dates.append(datetime.date.fromisoformat(token))
        except ValueError:
            continue
    return max(dates) if dates else None


def _plus_years(d: datetime.date, years: int) -> datetime.date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:            # 29 February
        return d.replace(year=d.year + years, day=28)


def certificate_warnings(row: dict, as_of: datetime.date) -> list[str]:
    """R3 certificates, only where the date exists: WRAP or BSCI expired (latest expiry before the
    as-of date); SLCP older than 2 years (latest assessment + 2 years before the as-of date)."""
    out = []
    wrap = _latest_date(row.get("wrap_certification.expiration_date", ""))
    if wrap and wrap < as_of:
        out.append("wrap_expired")
    bsci = _latest_date(row.get("amfori_compliance_status.bsci_audit.expiration_date", ""))
    if bsci and bsci < as_of:
        out.append("bsci_expired")
    slcp = _latest_date(row.get("slcp_assessment.most_recent_assessment_date", ""))
    if slcp and _plus_years(slcp, 2) < as_of:
        out.append("slcp_older_than_2y")
    return out
