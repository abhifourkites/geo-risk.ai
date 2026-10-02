"""The written rules that rate a GLEIF candidate (DECISIONS #5), for every company: the slice file's
candidates (adidas, Nike; gleif.file_rows) and GLEIF API results (gleif_api.py). R4 (clean.py) is unchanged.

- Names are compared after R4 cleaning (clean.clean_owner), and, for this comparison only, without the
  legal-form words R4 keeps: DE CV, SRL, S R L and PTE.
- Our name is compared with the GLEIF legal name and with each GLEIF other name; the best match decides.
- likely: an equal name, the GLEIF country (legal address) is one of the owner's site countries, and the
  entity is ACTIVE; capped at possible when its category is SOLE_PROPRIETOR or FUND, or its registration
  is LAPSED;
- possible: an equal name in another country, or a GLEIF name that starts with our name (as whole words)
  in one of the owner's site countries;
- unlikely: everything else.
"""
from . import clean

LIKELY, POSSIBLE, UNLIKELY = "1 likely - confirm", "2 possible - check", "3 unlikely"
# for the GLEIF comparison only: "VERTICAL KNITS SA DE CV" (MX), "L.I.M. ... S.R.L." (IT), "... PTE. LIMITED" (SG)
COMPARE_DROP = (("DE", "CV"), ("S", "R", "L"), ("SRL",), ("PTE",))
CAPPED_CATEGORIES = {"SOLE_PROPRIETOR", "FUND"}


def compare_name(s: str) -> str:
    """R4's cleaned name, then without DE CV, SRL, S R L and PTE (as whole words)."""
    words, out, i = clean.clean_owner(s).split(), [], 0
    while i < len(words):
        form = next((f for f in COMPARE_DROP if tuple(words[i:i + len(f)]) == f), None)
        if form:
            i += len(form)
        else:
            out.append(words[i])
            i += 1
    return " ".join(out)


def best_match(our_name: str, gleif_names: list[str]) -> tuple[str, str | None]:
    """How our name matches the best of the GLEIF names (legal name first, then other names):
    ("exact" | "starts_with" | "contains", the GLEIF name)."""
    ours = compare_name(our_name)
    best: tuple[str, str | None] = ("contains", gleif_names[0] if gleif_names else None)
    for g in gleif_names:
        theirs = compare_name(g)
        if ours and theirs == ours:
            return "exact", g
        if ours and theirs.startswith(ours + " ") and best[0] == "contains":
            best = ("starts_with", g)
    return best


def capped(category: str, registration_status: str) -> bool:
    return category in CAPPED_CATEGORIES or registration_status == "LAPSED"


def rate(our_name: str, countries: set[str], gleif_names: list[str], country: str, entity_status: str,
         category: str, registration_status: str) -> str:
    match, _ = best_match(our_name, gleif_names)
    same_country = country in countries
    if match == "exact" and same_country and entity_status == "ACTIVE":
        return POSSIBLE if capped(category, registration_status) else LIKELY
    if match == "exact" or (match == "starts_with" and same_country):
        return POSSIBLE
    return UNLIKELY


def flags(entity_status: str, registration_status: str, category: str) -> str:
    out = []
    if entity_status != "ACTIVE":
        out.append("not active")
    if registration_status == "LAPSED":
        out.append("registration lapsed")
    if category == "FUND":
        out.append("fund")
    if category == "SOLE_PROPRIETOR":
        out.append("sole proprietor")
    return "; ".join(out)


def other_names_of_file_row(r: dict) -> list[str]:
    """A slice-file row's GLEIF other name: the matched name, when the file matched an other name."""
    return [r["gleif_matched_name"]] if r["gleif_name_field"].startswith("OtherEntityNames") else []


def rate_file_row(r: dict) -> str:
    """A slice-file candidate under the rules: the best of its names (one or two), with the file's site countries."""
    names = [n for n in r["our_names"].split(" | ") if n.strip()]
    gleif_names = [r["gleif_legal_name"], *other_names_of_file_row(r)]
    countries = set(r["our_countries"].split("|"))
    return min(rate(n, countries, gleif_names, r["legal_country"], r["entity_status"], r["entity_category"],
                    r["registration_status"]) for n in names)
