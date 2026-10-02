"""Upload page pre-fill: who contributed each list string, and which of a contributor's lists are current.

It only suggests choices. The person checks them and clicks "Load this company"; loading is unchanged.
A list string is "<contributor>[ [Public List]][ (<list name>)]", for example
"Amazon.com, Inc. (Amazon Facility List 2026)" or "Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)".
"""
import re
from collections import defaultdict

from . import clean

PUBLIC = " [Public List]"
# 1900-2099 only: list names also hold "0323" and "1122" (s.Oliver list codes) and "FY2526" (INTERSPORT)
YEAR = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")
SUGGESTIONS = 5


def _tail(s: str) -> tuple[str, str | None]:
    """Split a trailing "(...)" off, brackets inside it kept: "EPA (TRI (2021) list)" -> ("EPA", "TRI (2021) list")."""
    if not s.endswith(")"):
        return s, None
    depth = 0
    for i in range(len(s) - 1, -1, -1):
        depth += {")": 1, "(": -1}.get(s[i], 0)
        if depth == 0:
            return s[:i].rstrip(), s[i + 1:-1]
    return s, None


def whole_names(strings: set[str]) -> set[str]:
    """Strings that end in brackets but are a whole contributor name, because another string adds a list name
    to them: the file has "Social & Labor Convergence Program (SLCP)" alone and with "(... List 2025)"."""
    heads = {_tail(t)[0] for t in strings if PUBLIC not in t}
    return {s for s in strings if s in heads}


def parse(s: str, whole: set[str] = frozenset()) -> tuple[str, str | None]:
    """(contributor name, list name or None): the string without its " [Public List]" and "(list name)" parts."""
    if PUBLIC in s:
        head, tail = s.split(PUBLIC, 1)
        return head.strip(), _tail(tail.strip())[1]
    return (s, None) if s in whole else _tail(s)


def hidden(s: str, whole: set[str] = frozenset()) -> bool:
    """Anonymous types ("A Brand / Retailer", "An Other": no list name) and "(Claimed)" entries."""
    return s.endswith("(Claimed)") or (re.match(r"An? ", s) is not None and parse(s, whole)[1] is None)


def current_lists(lists: list[str], whole: set[str] = frozenset()) -> list[str]:
    """The lists whose list name holds the latest year among them. Lists without a year are not current."""
    years = {s: [int(y) for y in YEAR.findall(parse(s, whole)[1] or "")] for s in lists}
    latest = max((y for ys in years.values() for y in ys), default=None)
    return [s for s in lists if latest in years[s]]


def suggest(rows: list[dict]) -> dict:
    """The top contributors by share of rows (anonymous types and "(Claimed)" entries left out), each with all
    its lists and its current ones. `preselect`: the one contributor on every row of the file, if there is one.
    `hidden`: the list strings the page hides unless "Show all lists" is ticked."""
    on_rows = [set(clean.split_pipe(r.get("contributor (list)"))) for r in rows]
    strings = set().union(*on_rows)
    whole = whole_names(strings)
    name = {s: parse(s, whole)[0] for s in strings if not hidden(s, whole)}
    rows_of: dict[str, set[int]] = defaultdict(set)
    sites_of: dict[str, int] = defaultdict(int)
    for i, on in enumerate(on_rows):
        for s in on & name.keys():
            rows_of[name[s]].add(i)
            sites_of[s] += 1
    lists_of: dict[str, list[str]] = defaultdict(list)
    for s in sorted(sites_of, key=lambda s: (-sites_of[s], s)):          # as on the page: most sites first
        lists_of[name[s]].append(s)
    ranked = sorted(rows_of, key=lambda c: (-len(rows_of[c]), c))
    on_every_row = [c for c in ranked if len(rows_of[c]) == len(rows)]
    return {
        "contributors": [{"name": c, "rows": len(rows_of[c]), "share": len(rows_of[c]) / len(rows),
                          "lists": lists_of[c], "current_lists": current_lists(lists_of[c], whole)}
                         for c in ranked[:SUGGESTIONS]],
        "preselect": on_every_row[0] if len(on_every_row) == 1 else None,
        "hidden": sorted(strings - name.keys()),
    }
