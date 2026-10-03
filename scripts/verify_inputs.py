#!/usr/bin/env python3
"""
Read-only check of the input files for Geographic Supplier Risk Intelligence (any customer).

What it does
  0-2   Lists the files; row and column counts; column names; checks that the three raw Open Supply Hub
        files have identical columns; lists every claim_* contact column (counts only, never values).
  3     Shows the list strings found in each raw file, and the demo customers' picked lists.
  4     Tests the written ingestion rules against data/reference/sites_prepared_for_build_v2.csv.
        The reference file is a regression check, not the definition of correct: differences are reported.
  5-11  Per demo customer (adidas, Nike, Apple, Samsung): coverage, risk basis, country-level and
        region-level concentration, owner measures, warnings, and overlaps between customers.
  12    Re-checks numbers written in README.md / ASSUMPTIONS.md / DECISIONS.md where the data allows.
  13-18 Vietnam boundary correction, GLEIF slice and parents, GDACS fixture, gleif_slice.py,
        raw GLEIF file (header always; full stream unless --skip-gleif-stream), GLEIF relationship file (17b), scale arithmetic,
        and (optional) the geo-service schema used as evidence for PostgreSQL.

It never writes, moves or deletes a file, and never calls the network. Standard library only.

Run:  python3 -B scripts/verify_inputs.py [--skip-gleif-stream] [--geo-schema PATH]
"""
import csv, datetime, hashlib, os, re, statistics, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
RAW = {"facilities": P("data", "raw", "facilities.csv"), "apple": P("data", "raw", "apple-osh.csv"),
       "samsung": P("data", "raw", "samsung.csv")}
FILES = dict(RAW, **{
    "gleif_raw":   P("data", "raw", "gleif", "20260929-1600-gleif-goldencopy-lei2-golden-copy.csv"),
    "gleif_tool":  P("tools", "gleif_slice.py"),
    "vn_mapping":  P("data", "mappings", "vietnam_2025_province_mapping.csv"),
    "sites_ref":   P("data", "reference", "sites_prepared_for_build_v2.csv"),
    "gleif_slice": P("data", "reference", "gleif_slice_for_our_data.csv"),
    "gleif_par":   P("data", "reference", "gleif_parents_checked.csv"),
    "gdacs":       P("data", "reference", "gdacs_current_exposure_2026-09-30.csv"),
})
DIFFS, OPENS, CHANGED, EXPECTED = [], [], [], []

def out(tag, msg):
    print(f"  [{tag}] {msg}")
    {"DIFF": DIFFS, "OPEN": OPENS, "CHANGED": CHANGED, "EXPECTED": EXPECTED}.get(tag, []).append(msg)

def check(label, prompt_value, computed):
    out("MATCH" if prompt_value == computed else "DIFF", f"{label}: expected {prompt_value} | computed {computed}")

def changed(label, before, now):
    """before = the number written earlier (old owner rule / reference file); now = the new written rule."""
    out("SAME" if before == now else "CHANGED", f"{label}: before {before} | now {now}")

def section(title):
    print("\n" + "=" * 100 + f"\n{title}\n" + "=" * 100)

def read_csv(path):
    csv.field_size_limit(sys.maxsize)
    with open(path, newline="", encoding="utf-8-sig") as f:
        rd = csv.reader(f); head = next(rd); rows = list(rd)
    return head, rows

T = lambda v: v == "True"
split_pipe = lambda s: [p.strip() for p in (s or "").split("|") if p.strip()]
pct = lambda x: f"{x:.1%}"

# ---------------------------------------------------------------------------------------------
section("0. Files under data/ and tools/, and the documents at the repo root")
for top in ("data", "tools"):
    for dirpath, dirs, files in os.walk(P(top)):
        dirs.sort()
        for fn in sorted(files):
            if fn == ".DS_Store": continue
            p = os.path.join(dirpath, fn)
            print(f"  {os.path.relpath(p, ROOT)}" + (f" (symlink -> {os.path.realpath(p)})" if os.path.islink(p) else ""))
known = {os.path.realpath(p) for p in FILES.values()}
extra = [os.path.relpath(os.path.join(d, f), ROOT) for top in ("data", "tools") for d, _, fs in os.walk(P(top))
         for f in fs if os.path.realpath(os.path.join(d, f)) not in known and f != ".DS_Store"]
out("MATCH" if not extra else "INFO", f"files not named in the prompts: {extra or 'none'}")
for doc in ("README.md", "ASSUMPTIONS.md", "DECISIONS.md", "AI_LOG.md", "docs/architecture/ARCHITECTURE.md"):
    print(f"  {doc}: {'present' if os.path.exists(P(doc)) else 'NOT FOUND'}")

# ---------------------------------------------------------------------------------------------
section("1. Input files: rows, columns, column names")
EXPECT = {"facilities": (1536, 181), "apple": (749, 181), "samsung": (187, 181), "sites_ref": (1536, 30),
          "gleif_slice": (440, None), "gleif_par": (30, None), "gdacs": (8, None), "vn_mapping": (39, None)}
data = {}
for key, path in FILES.items():
    rel = os.path.relpath(path, ROOT)
    if not os.path.exists(path): out("DIFF", f"{rel}: file not found"); continue
    if key in ("gleif_raw", "gleif_tool"):
        print(f"  {rel}: {os.path.getsize(path):,} bytes (read in sections 16-17)"); continue
    head, rows = read_csv(path)
    data[key] = (head, rows)
    print(f"  {rel}: {len(rows):,} rows, {len(head)} columns, rows with wrong column count: "
          f"{sum(1 for r in rows if len(r) != len(head))}")
    print(f"      column names: {head}")
    er, ec = EXPECT.get(key, (None, None))
    if er is not None: check(f"{rel} rows", er, len(rows))
    if ec is not None: check(f"{rel} columns", ec, len(head))
heads = {k: data[k][0] for k in RAW}
out("MATCH" if heads["facilities"] == heads["apple"] == heads["samsung"] else "DIFF",
    "the three raw files have identical columns (same names, same order): "
    f"{heads['facilities'] == heads['apple'] == heads['samsung']}")
rows_of = {k: [dict(zip(data[k][0], r)) for r in data[k][1]] for k in data}
ref = rows_of["sites_ref"]; ref_by = {r["os_id"]: r for r in ref}
REF_KEY = ["os_id", "region_key", "adidas", "adidas_list_type", "nike_feb_2024", "current", "closed", "parent_groups",
           "parent_conflict", "workers_est_median", "wrap_expired_on_record", "bsci_expired_on_record",
           "slcp_older_than_2y", "shared_point_any_site", "vn_region_source"]
miss = [c for c in REF_KEY if c not in data["sites_ref"][0]]
out("MATCH" if not miss else "DIFF", f"reference key columns present: {len(REF_KEY) - len(miss)}/{len(REF_KEY)} {miss or ''}")

# ---------------------------------------------------------------------------------------------
section("2. Personal data: every claim_* contact column (counts only)")
CONTACT = re.compile(r"contact|email|phone|website|office")
claim_cols = [c for c in heads["facilities"] if c.startswith("claim_")]
contact_cols = [c for c in claim_cols if CONTACT.search(c)]
print(f"  claim_* columns in the files: {len(claim_cols)}")
print(f"  claim_* contact columns (name, email, phone, website, office): {contact_cols}")
for k in RAW:
    counts = {c: sum(1 for r in rows_of[k] if r[c].strip()) for c in contact_cols}
    both = sum(1 for r in rows_of[k] if r["claim_point_of_contact"].strip() and r["claim_point_of_contact_email"].strip())
    print(f"  {k}: non-empty per contact column {counts}; rows with contact name AND email: {both}")
check("Apple rows with claim_point_of_contact and claim_point_of_contact_email filled", 1,
      sum(1 for r in rows_of["apple"] if r["claim_point_of_contact"].strip() and r["claim_point_of_contact_email"].strip()))
out("INFO", "ingestion keeps only the columns it needs (section 4), so every claim_* column is dropped")

# ---------------------------------------------------------------------------------------------
section("3. List strings in `contributor (list)`, and the demo customers' picks")
for k in RAW:
    c = Counter(p for r in rows_of[k] for p in split_pipe(r["contributor (list)"]))
    print(f"  {k}: {len(c)} distinct strings (the upload page must list and search these)")
# The picks a user would make on the upload page for the four demo customers.
DEMO = {
    "adidas":  dict(file="facilities", lists=[
                    "adidas (OSHub-Data-Template-adidas-Primary-Jan 2026)",
                    "adidas (OSHub-Data-Template-adidas-Licensee-Jan 2026)",
                    "adidas (OSHub-Data-Template-adidas-Wet Process Suppliers-Apr 2026)"], current="all"),
    "Nike":    dict(file="facilities", lists=[
                    "Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)",
                    "Nike [Public List] (Nike Inc. Brand(s) August 2023 Facility List)",
                    "Nike [Public List] (Nike Inc. February 2022 Facility List)",
                    "Nike [Public List] (Nike Facility List November 2020)"],
                 current=["Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)"]),
    "Apple":   dict(file="apple", lists=["Apple [Public List] (Apple 2019 Facility List)"], current="all"),
    "Samsung": dict(file="samsung", lists=["Samsung [Public List] (Samsung 2021 Facility List)"], current="all"),
}
for cust, d in DEMO.items():
    d["current"] = d["lists"] if d["current"] == "all" else d["current"]
    c = Counter(p for r in rows_of[d["file"]] for p in split_pipe(r["contributor (list)"]))
    for s in d["lists"]:
        years = re.findall(r"(?<!\d)(?:19|20)\d{2}(?!\d)", s)
        out("MATCH" if s in c else "DIFF", f"{cust}: list {'CURRENT' if s in d['current'] else 'older  '} {s!r} "
            f"in {d['file']}: {s in c}; year written in the string: {years or 'none'}")
nike_ihm = [s for k in RAW for s in {p for r in rows_of[k] for p in split_pipe(r['contributor (list)'])} if "IHM" in s.upper()]
out("INFO", f"strings mentioning 'IHM': {nike_ihm or 'none'}")

def open_sites(cust):
    d = DEMO[cust]; cur = set(d["current"])
    return [r for r in rows_of[d["file"]]
            if cur & set(split_pipe(r["contributor (list)"])) and r["is_closed"] != "True"]
OPEN = {c: open_sites(c) for c in DEMO}

# ---------------------------------------------------------------------------------------------
section("4. Written ingestion rules, tested against the reference file (adidas + Nike)")
fac = rows_of["facilities"]; fac_by = {r["os_id"]: r for r in fac}
out("INFO", f"same os_id set in facilities.csv and the reference: {set(fac_by) == set(ref_by)}")

def agree(label, fn, col, show=4, known=None):
    """known = the agreement count of a known, explained difference from the old reference file."""
    bad = [(k, fn(r), ref_by[k][col]) for k, r in fac_by.items() if fn(r) != ref_by[k][col]]
    ok = len(fac_by) - len(bad)
    tag = "MATCH" if not bad else ("EXPECTED" if known is not None and ok == known else "DIFF")
    out(tag, f"{label} vs reference `{col}`: {ok}/{len(fac_by)} rows agree" + (f" (known difference: expected {known})" if tag == "EXPECTED" else ""))
    for x in bad[:show]: print(f"      os_id {x[0]}: ours {x[1]!r} | reference {x[2]!r}")
    return bad

on_list = lambda r, lists: bool(set(lists) & set(split_pipe(r["contributor (list)"])))
agree("R1 adidas (on any picked adidas list)", lambda r: str(on_list(r, DEMO["adidas"]["current"])), "adidas")
agree("R1 Nike current (Feb 2024 list)", lambda r: str(on_list(r, DEMO["Nike"]["current"])), "nike_feb_2024")
agree("R1 Nike any list", lambda r: str(on_list(r, DEMO["Nike"]["lists"])), "nike_any_list")
agree("R1 current (a current list of either customer)",
      lambda r: str(on_list(r, DEMO["adidas"]["current"] + DEMO["Nike"]["current"])), "current")
agree("R1 closed", lambda r: str(r["is_closed"] == "True"), "closed")
ORDER = {"primary": 0, "licensee": 1, "wet process": 2}
def ad_type(r):
    t = [re.search(r"adidas-(Primary|Licensee|Wet Process)", s).group(1).lower() for s in split_pipe(r["contributor (list)"])
         if s in DEMO["adidas"]["lists"]]
    return min(t, key=ORDER.get) if t else ""
agree("adidas list type (regression only: primary > licensee > wet process)", ad_type, "adidas_list_type", 2)
multi = Counter(tuple(sorted({s for s in split_pipe(r["contributor (list)"]) if s in DEMO["adidas"]["lists"]}))
                for r in fac if len({s for s in split_pipe(r["contributor (list)"]) if s in DEMO["adidas"]["lists"]}) > 1)
out("INFO", f"adidas sites on 2+ adidas lists: {sum(multi.values())}")

def worker_value(tok):
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", tok)
    if m: return (int(m.group(1)) + int(m.group(2))) / 2
    return float(tok) if re.fullmatch(r"\d+", tok) else None
def workers(r):
    vals = [worker_value(t) for t in split_pipe(r["number_of_workers"])]
    if not vals or any(v is None for v in vals): return None
    return float(statistics.median(vals))
agree("R2 workers (median of values; range = midpoint)",
      lambda r: "" if workers(r) is None else str(workers(r)), "workers_est_median")
for k in RAW:
    toks = [t for r in rows_of[k] for t in split_pipe(r["number_of_workers"])]
    kinds = Counter("integer" if re.fullmatch(r"\d+", t) else "range" if re.fullmatch(r"\d+\s*-\s*\d+", t) else "other" for t in toks)
    print(f"  {k}: number_of_workers value kinds {dict(kinds)}")

def shared_points(k):
    c = Counter((r["lat"], r["lng"]) for r in rows_of[k])
    return {r["os_id"] for r in rows_of[k] if c[(r["lat"], r["lng"])] > 1}
SHARED = {k: shared_points(k) for k in RAW}
agree("R3 same coordinates as another site (same lat/lng as another row of the same download)",
      lambda r: str(r["os_id"] in SHARED["facilities"]), "shared_point_any_site", 2)
out("INFO", f"rows of facilities.csv sharing a point with another row: {len(SHARED['facilities'])}")

def dates(s): return [datetime.date.fromisoformat(x) for x in split_pipe(s)]
def plus_years(d, n):
    try: return d.replace(year=d.year + n)
    except ValueError: return d.replace(year=d.year + n, day=28)
CERT = [("wrap_certification.expiration_date", "wrap_expired_on_record", 0),
        ("amfori_compliance_status.bsci_audit.expiration_date", "bsci_expired_on_record", 0),
        ("slcp_assessment.most_recent_assessment_date", "slcp_older_than_2y", 2)]
windows = []
for col, flag, yrs in CERT:
    res = {}
    for pick in (max, min):
        lo, hi, bad = None, None, 0
        for k, r in fac_by.items():
            ds = dates(r[col]); f = T(ref_by[k][flag])
            if not ds: bad += f; continue
            d = plus_years(pick(ds), yrs)
            if f: lo = d if lo is None or d > lo else lo
            else: hi = d if hi is None or d < hi else hi
        a = lo + datetime.timedelta(days=1) if lo else None
        res[pick.__name__] = (a, hi, a is not None and hi is not None and a <= hi and bad == 0)
    windows.append(res["max"][:2])
    print(f"  R3 {flag}: latest-date rule AS_OF {res['max'][0]}..{res['max'][1]} ok={res['max'][2]}; "
          f"earliest-date rule ok={res['min'][2]}; rows with a date {sum(1 for r in fac if r[col].strip())}, "
          f"reference True {sum(1 for r in ref if T(r[flag]))}")
a = max(w[0] for w in windows); b = min(w[1] for w in windows)
out("INFO", f"AS_OF dates consistent with all three certificate flags (latest-date rule): {a} to {b}")
out("OPEN", "the as-of date for certificate warnings is not documented")

# Owner rule R4 (no ASCII folding, no quirks copied from the reference):
#   upper case (where the script has case); '&' -> AND; punctuation -> space; collapse spaces;
#   remove the listed legal-form words; drop placeholders; drop an owner name equal to the site's own name
#   ONLY when the site has another owner name (if it is the site's only owner, keep it).
LEGAL_WORDS = {"CO", "COMPANY", "CORP", "CORPORATION", "GMBH", "GROUP", "HOLDING", "HOLDINGS", "INC", "JSC",
               "LIMITED", "LLC", "LTD", "PLC", "PRIVATE", "PT", "PVT", "SA"}
PLACEHOLDER = re.compile(r"^(NO GROUP( \w+)?|N A|NA|NULL)$")   # NULL: "null" is an owner value 6 times in the raw facilities file
def basic(s):   # upper case, & -> AND, punctuation -> space, collapse spaces (str.split: any Unicode space)
    return " ".join(re.sub(r"[^\w\s]", " ", (s or "").upper().replace("&", " AND ")).split())
def clean_owner(s): return " ".join(w for w in basic(s).split() if w not in LEGAL_WORDS)
def cleaned_names(r):
    seen = []
    for t in split_pipe(r["parent_company"]):
        if PLACEHOLDER.match(basic(t)): continue          # placeholder test runs before legal words are removed
        n = clean_owner(t)
        if n and n not in seen: seen.append(n)
    return seen
def owners(r):        # R4 as now written
    site, seen = clean_owner(r["name"]), cleaned_names(r)
    others = [n for n in seen if n != site]
    return others if others else seen                     # keep a self-named owner when it is the only one
def owners_prev(r):   # the previous revision's step 6 (always drop a self-named owner) - only to report changes
    site = clean_owner(r["name"])
    return [n for n in cleaned_names(r) if n != site]
OWN = {k: {r["os_id"]: owners(r) for r in rows_of[k]} for k in RAW}
OWN_PREV = {k: {r["os_id"]: owners_prev(r) for r in rows_of[k]} for k in RAW}
OWN_KEEP = {k: {r["os_id"]: cleaned_names(r) for r in rows_of[k]} for k in RAW}   # 'never drop the self-name' option
fold = lambda s: " ".join(unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().split())
diff_sites = [(k, OWN["facilities"][k], split_pipe(ref_by[k]["parent_groups"])) for k in fac_by
              if set(OWN["facilities"][k]) != set(split_pipe(ref_by[k]["parent_groups"]))]
_r4_ok = len(fac_by) - len(diff_sites)
out("MATCH" if not diff_sites else ("EXPECTED" if _r4_ok == 1437 else "DIFF"),
    f"R4 owner names (written rule) vs reference `parent_groups`: same set on {_r4_ok}/{len(fac_by)} sites"
    + (" (known difference: expected 1437)" if diff_sites and _r4_ok == 1437 else ""))
reasons = Counter()
for k, ours, theirs in diff_sites:
    why = []
    if clean_owner(fac_by[k]["name"]) in ours: why.append("keeps a self-named owner that is the site's only owner (reference drops it)")
    site_f = fold(clean_owner(fac_by[k]["name"]))
    if any(fold(n) == site_f and n != clean_owner(fac_by[k]["name"]) for n in ours):
        why.append("same-as-site test no longer matches: site and owner differ only by accents")
    if any(not n.isascii() for n in ours): why.append("keeps non-ASCII characters (reference drops them)")
    if "\xa0" in fac_by[k]["parent_company"].strip(): why.append("treats a no-break space as a space (reference deletes it)")
    if "NULL" in theirs and "NULL" not in ours: why.append('drops "null" as a placeholder (reference keeps it as an owner)')
    reasons.update(why or ["other"])
    if len(why) != 1 or not why[0].startswith("keeps a self-named"):
        print(f"      os_id {k}: ours {ours} | reference {theirs} | {'; '.join(why) or 'other'}")
out("INFO", f"R4 vs reference, sites by reason (a site can have several): {dict(reasons)}")
nonascii_owner_rows = {k: sum(1 for r in rows_of[k] for n in OWN[k][r["os_id"]] if not n.isascii()) for k in RAW}
out("INFO", f"owner names kept that contain non-ASCII characters, per file: {nonascii_owner_rows}")
comb = {k: sum(1 for r in rows_of[k] for ch in r["parent_company"] + r["name"] if unicodedata.category(ch) == "Mn") for k in RAW}
out("INFO", f"combining marks in owner/site names (would be split by the punctuation step): {comb}")
agree("R5 owner conflict (2+ owner names after R4)", lambda r: str(len(OWN["facilities"][r["os_id"]]) > 1), "parent_conflict", 6, known=1529)
agree("product_type kept as reported", lambda r: r["product_type"], "product_words_as_reported_any_contributor", 2)
out("INFO", f"no raw column names a state/province/region; reference region_key == state_code_boundary outside Vietnam: "
            f"{sum(1 for r in ref if r['country_code'] != 'VN' and r['region_key'] == r['state_code_boundary'])}"
            f"/{sum(1 for r in ref if r['country_code'] != 'VN')}")

# ---------------------------------------------------------------------------------------------
section("5. Coverage per demo customer (open sites)")
PROMPT_COV = {  # from the task prompt's table
    "adidas":  dict(open=766, owner="71.9%", workers="719 (93.9%)", ftype=432),
    "Nike":    dict(open=625, owner="100.0%", workers="625 (100.0%)", ftype=494),
    "Apple":   dict(open=749, owner="8.8% (66)", workers="65 (8.7%)", ftype=0, cert="0 / 0 / 1"),
    "Samsung": dict(open=187, owner="100.0%", workers="4 (2.1%)", ftype=0, cert="0 / 0 / 0"),
}
EXPECT_OWN = {"adidas": "551 (71.9%)", "Nike": "625 (100.0%)", "Apple": "66 (8.8%)", "Samsung": "187 (100.0%)"}  # prompt 3
COV = {}
for cust, rows in OPEN.items():
    k = DEMO[cust]["file"]; n = len(rows)
    ok = sum(1 for r in rows if OWN[k][r["os_id"]]); wk = sum(1 for r in rows if workers(r) is not None)
    cov = dict(n=n, owner=ok, workers=wk, ftype=sum(1 for r in rows if r["facility_type"].strip()),
               cert=[sum(1 for r in rows if r[c].strip()) for c, _, _ in CERT],
               coords=sum(1 for r in rows if r["lat"].strip() and r["lng"].strip()),
               country=sum(1 for r in rows if r["country_code"].strip()))
    COV[cust] = cov
    pc = PROMPT_COV[cust]
    check(f"{cust} open sites", pc["open"], n)
    owner_txt = f"{pct(ok / n)} ({ok})" if "(" in pc["owner"] else pct(ok / n)
    check(f"{cust} owner known (R4), share", pc["owner"], owner_txt)
    check(f"{cust} owner known (R4), count and share", EXPECT_OWN[cust], f"{ok} ({pct(ok / n)})")
    raw_f = sum(1 for r in rows if r["parent_company"].strip())
    prev = sum(1 for r in rows if OWN_PREV[k][r["os_id"]])
    out("INFO", f"{cust}: parent_company filled {raw_f} ({pct(raw_f / n)}); R4 now {ok} ({pct(ok / n)})")
    changed(f"{cust} owner known (previous step 6 -> now)", f"{prev} ({pct(prev / n)})", f"{ok} ({pct(ok / n)})")
    changed(f"{cust} owner unknown (previous step 6 -> now)", f"{n - prev} ({pct((n - prev) / n)})", f"{n - ok} ({pct((n - ok) / n)})")
    check(f"{cust} workers known", pc["workers"], f"{wk} ({pct(wk / n)})")
    check(f"{cust} facility_type filled", pc["ftype"], cov["ftype"])
    if "cert" in pc: check(f"{cust} WRAP / BSCI / SLCP dates filled", pc["cert"], " / ".join(map(str, cov["cert"])))
    else: out("INFO", f"{cust} WRAP / BSCI / SLCP dates filled: {' / '.join(map(str, cov['cert']))}")
    check(f"{cust} coordinates filled", "all", "all" if cov["coords"] == n else f"{cov['coords']} of {n}")
    out("INFO", f"{cust} country_code filled: {cov['country']} of {n}")

# ---------------------------------------------------------------------------------------------
section("6. Risk basis per customer: workers if known for >= 90% of open sites, else site counts")
BASIS = {}
for cust, cov in COV.items():
    share = cov["workers"] / cov["n"]
    BASIS[cust] = "workers" if share >= 0.90 else "sites"
    print(f"  {cust}: workers known {cov['workers']} of {cov['n']} ({pct(share)}) -> basis: {BASIS[cust]}")

def weight(cust, r):
    if BASIS[cust] == "sites": return 1.0
    return workers(r)        # None = unknown; excluded from worker shares (prompt: sum over sites where known)

def shares(cust, key_fn, multi=False):
    """Share of the customer's basis per key. key_fn returns one key, or a list of keys when multi=True."""
    tot, per, sites = 0.0, defaultdict(float), defaultdict(set)
    for r in OPEN[cust]:
        w = weight(cust, r)
        keys = key_fn(r) if multi else [key_fn(r)]
        for g in keys: sites[g].add(r["os_id"])
        if w is None: continue
        tot += w
        for g in keys: per[g] += w
    return {g: v / tot for g, v in per.items()}, sites

def levels(sh):
    return (sum(1 for v in sh.values() if v >= .10), sum(1 for v in sh.values() if .05 <= v < .10))

# ---------------------------------------------------------------------------------------------
section("7. Country-level concentration (country_code), every customer, on its risk basis")
COUNTRY = {}
for cust in DEMO:
    sh, _ = shares(cust, lambda r: r["country_code"])
    COUNTRY[cust] = sh
    hi, wa = levels(sh)
    top = sorted(((v, g) for g, v in sh.items() if v >= .05), reverse=True)
    print(f"  {cust} (basis {BASIS[cust]}): {len(sh)} countries; High (>=10%) {hi}; Watch (5-10%) {wa}")
    print(f"      >= 5%: " + ", ".join(f"{g} {pct(v)}" for v, g in top))
    if BASIS[cust] == "workers":   # also show the site-count view for comparison
        s2 = Counter(r["country_code"] for r in OPEN[cust])
        print(f"      same countries by share of sites: " + ", ".join(f"{g} {pct(s2[g] / len(OPEN[cust]))}" for v, g in top))

check("countries at High (>= 10%) per customer", "adidas 3, Nike 3, Apple 2, Samsung 4",
      ", ".join(f"{c} {levels(COUNTRY[c])[0]}" for c in DEMO))

# ---------------------------------------------------------------------------------------------
section("8. Region level (adidas, Nike only: region_key exists only in the reference file) - regression")
REG = {}
for cust in ("adidas", "Nike"):
    sh, _ = shares(cust, lambda r: ref_by[r["os_id"]]["region_key"]); REG[cust] = sh
    hi, wa = levels(sh)
    print(f"  {cust}: regions High {hi}, Watch {wa}; >= 5%: " +
          ", ".join(f"{g} {pct(v)}" for v, g in sorted(((v, g) for g, v in sh.items() if v >= .05), reverse=True)))
n_sites = Counter(ref_by[r["os_id"]]["region_key"] for r in OPEN["Nike"])
check("Nike VN:Dong Nai share of sites", "5.4%", pct(n_sites["VN:Dong Nai"] / len(OPEN["Nike"])))
check("Nike VN:Dong Nai share of workers", "13.5%", pct(REG["Nike"]["VN:Dong Nai"]))
check("adidas ID-JT share of workers", "10.5%", pct(REG["adidas"]["ID-JT"]))
for cust, e10, e5 in (("adidas", 1, 4), ("Nike", 2, 5)):
    check(f"{cust} regions at >= 10% / >= 5% of workers", f"{e10} / {e5}",
          f"{sum(1 for v in REG[cust].values() if v >= .10)} / {sum(1 for v in REG[cust].values() if v >= .05)}")
for cust in ("adidas", "Nike"):
    print(f"  {cust} regions at >= 3% of workers: "
          f"{sum(1 for v in REG[cust].values() if v >= .03)}")

# ---------------------------------------------------------------------------------------------
section("9. Owner measures per customer (written rule R4, on the risk basis)")
OSH, OSITES = {}, {}
for cust in DEMO:
    k = DEMO[cust]["file"]
    sh, st = shares(cust, lambda r: OWN[k][r["os_id"]], multi=True)   # a site counts in full under each owner
    OSH[cust], OSITES[cust] = sh, st
    hi, wa = levels(sh)
    two = [o for o, s in st.items() if len(s) >= 2]
    one_country = sum(1 for o in two if len({fac_by.get(x, {}).get("country_code") if k == "facilities" else
                                             next(r["country_code"] for r in OPEN[cust] if r["os_id"] == x) for x in st[o]}) == 1)
    conf = sum(1 for r in OPEN[cust] if len(OWN[k][r["os_id"]]) > 1)
    print(f"  {cust} (basis {BASIS[cust]}): owners {len(st)}; High {hi}; Watch {wa}; owners with 2+ sites {len(two)}, "
          f"all in one country {one_country}; open sites with an owner conflict {conf}")
    print(f"      owners >= 5%: " + ", ".join(f"{g} {pct(v)}" for v, g in sorted(((v, g) for g, v in sh.items() if v >= .05), reverse=True)))

def country_of(cust, x):
    return next(r["country_code"] for r in OPEN[cust] if r["os_id"] == x)
def owner_summary(cust, own):
    k = DEMO[cust]["file"]
    sh, st = shares(cust, lambda r: own[k][r["os_id"]], multi=True)
    two = [o for o, x in st.items() if len(x) >= 2]
    one_c = sum(1 for o in two if len({country_of(cust, x) for x in st[o]}) == 1)
    one_r = (sum(1 for o in two if len({ref_by[x]["region_key"] for x in st[o]}) == 1) if k == "facilities" else "-")
    watch = ", ".join(f"{g} {pct(v)}" for v, g in sorted(((v, g) for g, v in sh.items() if .05 <= v < .10), reverse=True)) or "none"
    high = ", ".join(f"{g} {pct(v)}" for v, g in sorted(((v, g) for g, v in sh.items() if v >= .10), reverse=True)) or "none"
    conf = sum(1 for r in OPEN[cust] if len(own[k][r["os_id"]]) > 1)
    return dict(counts=f"{len(st)} / {len(two)} / {one_c}", region=one_r, watch=watch, high=high, conf=conf)
EXPECT_O = {  # prompt 3: owners / 2+ sites / all in one country; one region; conflicts; Watch owners
    "adidas":  ("509 / 156 / 56", 27, 187, "POU CHEN 7.4%, THE LOOK MACAO COMMERCIAL OFFSHORE 5.9%"),
    "Nike":    ("530 / 155 / 49", 19, 231, "FENG TAY 9.3%, TAEKWANG 6.6%, POU CHEN 6.1%, CHANGSHIN 5.9%"),
    "Apple":   ("41 / 12 / 2", "-", 3, "none"),
    "Samsung": ("102 / 42 / 4", "-", 0, "none"),
}
print("\n  R4 now vs the numbers expected in prompt 3, and vs the previous step 6:")
for cust in DEMO:
    now, prev = owner_summary(cust, OWN), owner_summary(cust, OWN_PREV)
    e = EXPECT_O[cust]
    check(f"{cust} owners / owners with 2+ sites / all in one country", e[0], now["counts"])
    if e[1] != "-": check(f"{cust} owners with 2+ sites all in one region", e[1], now["region"])
    check(f"{cust} open sites with an owner conflict", e[2], now["conf"])
    check(f"{cust} Watch owners (5-10%)", e[3], now["watch"])
    out("INFO", f"{cust} High owners (>= 10%): {now['high']}")
    changed(f"{cust} owners / 2+ sites / one country (previous step 6 -> now)", prev["counts"], now["counts"])
    if e[1] != "-": changed(f"{cust} owners all in one region (previous -> now)", prev["region"], now["region"])
    changed(f"{cust} conflicts (previous -> now)", prev["conf"], now["conf"])
    changed(f"{cust} Watch owners (previous -> now)", prev["watch"], now["watch"])
for cust in DEMO:
    k = DEMO[cust]["file"]
    out("INFO", f"{cust} open sites with an owner conflict if the self-name were NEVER dropped (rejected option): "
                f"{sum(1 for r in OPEN[cust] if len(OWN_KEEP[k][r['os_id']]) > 1)} (R4 now: "
                f"{sum(1 for r in OPEN[cust] if len(OWN[k][r['os_id']]) > 1)})")
SELF_ONLY = {}
for cust in DEMO:
    k = DEMO[cust]["file"]
    has = [r for r in OPEN[cust] if cleaned_names(r)]
    only = [r for r in has if set(cleaned_names(r)) == {clean_owner(r["name"])}]
    SELF_ONLY[cust] = (len(only), len(has), len(OPEN[cust]))
    out("INFO", f"{cust}: open sites whose only owner is their own company name: {len(only)} of {len(has)} sites with an owner "
                f"({len(OPEN[cust])} open sites)")
check("Samsung sites carrying only their own company name as owner", "179 of 187", f"{SELF_ONLY['Samsung'][0]} of {SELF_ONLY['Samsung'][2]}")
check("Apple sites carrying only their own company name as owner, of the sites with an owner", "45 of 66",
      f"{SELF_ONLY['Apple'][0]} of {SELF_ONLY['Apple'][1]}")
for cust, o in (("Apple", "INTEL"), ("Apple", "MICRON TECHNOLOGY"), ("Samsung", "HITACHI")):
    st = shares(cust, lambda r: OWN[DEMO[cust]["file"]][r["os_id"]], multi=True)[1]
    stp = shares(cust, lambda r: OWN_PREV[DEMO[cust]["file"]][r["os_id"]], multi=True)[1]
    out("INFO", f"{cust} owner {o!r}: sites now {len(st.get(o, ()))}, with the previous step 6 {len(stp.get(o, ()))}")
print("\n  Changes caused by the written owner rule (before = reference `parent_groups`, as in the earlier plan):")
def ref_owner_measures(cust):
    tot, per, st, reg = 0.0, defaultdict(float), defaultdict(set), defaultdict(set)
    for r in OPEN[cust]:
        g = split_pipe(ref_by[r["os_id"]]["parent_groups"]); w = workers(r)
        for o in g: st[o].add(r["os_id"]); reg[o].add(ref_by[r["os_id"]]["region_key"])
        if w is None: continue
        tot += w
        for o in g: per[o] += w
    return {o: v / tot for o, v in per.items()}, st, reg
for cust in ("adidas", "Nike"):
    rsh, rst, rreg = ref_owner_measures(cust)
    nreg = {o: {ref_by[x]["region_key"] for x in s} for o, s in OSITES[cust].items()}
    n = len(OPEN[cust]); ok_new = sum(1 for r in OPEN[cust] if OWN["facilities"][r["os_id"]])
    ok_ref = sum(1 for r in OPEN[cust] if split_pipe(ref_by[r["os_id"]]["parent_groups"]))
    changed(f"{cust} owner known", f"{ok_ref} ({pct(ok_ref / n)})", f"{ok_new} ({pct(ok_new / n)})")
    changed(f"{cust} owner unknown", f"{n - ok_ref} ({pct((n - ok_ref) / n)})", f"{n - ok_new} ({pct((n - ok_new) / n)})")
    two_r = [o for o, s in rst.items() if len(s) >= 2]; two_n = [o for o, s in OSITES[cust].items() if len(s) >= 2]
    changed(f"{cust} owners with 2+ sites / all in one region", f"{len(two_r)} / {sum(1 for o in two_r if len(rreg[o]) == 1)}",
            f"{len(two_n)} / {sum(1 for o in two_n if len(nreg[o]) == 1)}")
    for t in (.10, .05, .03):
        changed(f"{cust} owners at >= {t:.0%} of workers", sum(1 for v in rsh.values() if v >= t),
                sum(1 for v in OSH[cust].values() if v >= t))
    changed(f"{cust} open sites with an owner conflict",
            sum(1 for r in OPEN[cust] if len(split_pipe(ref_by[r["os_id"]]["parent_groups"])) > 1),
            sum(1 for r in OPEN[cust] if len(OWN["facilities"][r["os_id"]]) > 1))
    for o in ("POU CHEN", "FENG TAY", "SHAHI", "SHAHI EXPORTS"):
        if o in rst or o in OSITES[cust]:
            changed(f"{cust} owner {o}", f"{len(rst.get(o, ()))} sites, {pct(rsh.get(o, 0))}",
                    f"{len(OSITES[cust].get(o, ()))} sites, {pct(OSH[cust].get(o, 0))}")
both_conf = {r["os_id"] for c in ("adidas", "Nike") for r in OPEN[c] if len(OWN["facilities"][r["os_id"]]) > 1}
both_conf_ref = {r["os_id"] for c in ("adidas", "Nike") for r in OPEN[c] if len(split_pipe(ref_by[r["os_id"]]["parent_groups"])) > 1}
changed("open sites with an owner conflict, adidas + Nike counted once", len(both_conf_ref), len(both_conf))

# ---------------------------------------------------------------------------------------------
section("10. Between customers: shared sites and shared owners (optional view)")
ids = {c: {r["os_id"] for r in OPEN[c]} for c in DEMO}
custs = list(DEMO)
for i, a_ in enumerate(custs):
    for b_ in custs[i + 1:]:
        so = len(set(OSITES[a_]) & set(OSITES[b_]))
        print(f"  {a_} & {b_}: shared open sites {len(ids[a_] & ids[b_])}; shared owner names {so}")
check("open sites on both Apple's and Samsung's lists", 7, len(ids["Apple"] & ids["Samsung"]))
check("Apple or Samsung sites also open for adidas or Nike", 0, len((ids["Apple"] | ids["Samsung"]) & (ids["adidas"] | ids["Nike"])))
ref_ad = {o for r in OPEN["adidas"] for o in split_pipe(ref_by[r["os_id"]]["parent_groups"])}
ref_nk = {o for r in OPEN["Nike"] for o in split_pipe(ref_by[r["os_id"]]["parent_groups"])}
changed("owners shared by adidas and Nike (reference -> now)", len(ref_ad & ref_nk), len(set(OSITES["adidas"]) & set(OSITES["Nike"])))
check("owners shared by adidas and Nike", 173, len(set(OSITES["adidas"]) & set(OSITES["Nike"])))
check("owners shared by Apple and Samsung", 12, len(set(OSITES["Apple"]) & set(OSITES["Samsung"])))
prev_sites = {c: {o for r in OPEN[c] for o in OWN_PREV[DEMO[c]["file"]][r["os_id"]]} for c in DEMO}
for i, a_ in enumerate(custs):
    for b_ in custs[i + 1:]:
        changed(f"shared owner names {a_} & {b_} (previous step 6 -> now)", len(prev_sites[a_] & prev_sites[b_]),
                len(set(OSITES[a_]) & set(OSITES[b_])))
NEED = ["os_id", "name", "address", "country_code", "country_name", "lat", "lng", "sector", "contributor (list)",
        "number_of_workers", "parent_company", "facility_type", "processing_type", "product_type", "is_closed",
        "wrap_certification.expiration_date", "amfori_compliance_status.bsci_audit.expiration_date",
        "slcp_assessment.most_recent_assessment_date"]
ap = {r["os_id"]: r for r in rows_of["apple"]}; sm = {r["os_id"]: r for r in rows_of["samsung"]}
dcols = Counter(c for x in ids["Apple"] & ids["Samsung"] for c in NEED if ap[x][c] != sm[x][c])
out("INFO", f"the 7 shared sites: needed columns that differ between apple-osh.csv and samsung.csv: {dict(dcols) or 'none'}")

# ---------------------------------------------------------------------------------------------
section("11. Warnings per customer (open sites)")
for cust in DEMO:
    k = DEMO[cust]["file"]; n = len(OPEN[cust])
    sp = sum(1 for r in OPEN[cust] if r["os_id"] in SHARED[k])
    cf = sum(1 for r in OPEN[cust] if len(OWN[k][r["os_id"]]) > 1)
    yrs = [re.findall(r"(?:19|20)\d{2}", s) for s in DEMO[cust]["current"]]
    shown = [name for name, c in zip(("WRAP", "BSCI", "SLCP"), COV[cust]["cert"]) if c]
    print(f"  {cust}: same coordinates as another site {sp} of {n}; owner conflict {cf}; certificate dates filled "
          f"WRAP/BSCI/SLCP {COV[cust]['cert']} -> certificate warnings shown for {shown or 'none'}; current list years {yrs}")
op = [r for r in fac if r["os_id"] in ids["adidas"] | ids["Nike"]]
check("open adidas/Nike sites sharing a point with another site in the download (all / adidas / Nike)",
      "114 / 66 / 58", f"{sum(1 for r in op if r['os_id'] in SHARED['facilities'])} / "
      f"{sum(1 for r in OPEN['adidas'] if r['os_id'] in SHARED['facilities'])} / "
      f"{sum(1 for r in OPEN['Nike'] if r['os_id'] in SHARED['facilities'])}")

# ---------------------------------------------------------------------------------------------
section("12. Numbers in the README / ASSUMPTIONS / DECISIONS drafts that the data can re-check")
op_ft = [r for r in op if r["facility_type"].strip()]
fpa_any = sum(1 for r in op_ft if "Final Product Assembly" in split_pipe(r["facility_type"]))
fpa_only = sum(1 for r in op_ft if set(split_pipe(r["facility_type"])) == {"Final Product Assembly"})
check("open adidas/Nike sites with a facility type: 'Final Product Assembly' among its types", "747 of 850",
      f"{fpa_any} of {len(op_ft)}")
out("INFO", f"of those, 'Final Product Assembly' is the ONLY type for {fpa_only} of {len(op_ft)}")
check("adidas open sites with any product words (README, What we cut: 32.9% of 766)", 252, sum(1 for r in OPEN["adidas"] if r["product_type"].strip()))
out("INFO", "not re-checkable here (the word list, the HS test and GLEIF's relationship listing are not in the repo): "
            "262 of 1,303 (20.1%); 70 of 90; 20; 149 of 255; 489,389; Nike's 3 'NIKE IHM' sites")
sl_names = {basic(n) for r in rows_of["gleif_slice"] if r["kind"] == "owner" for n in r["our_names"].split(" | ")}
hwa = sorted({o for c in ("adidas", "Nike") for o in OSITES[c] if "HWA" in o and ("SEUNG" in o or o.startswith("HWASEUNG"))})
print(f"  owner names containing HWA + SEUNG: {[(o, [len(OSITES[c].get(o, ())) for c in ('adidas', 'Nike')], o in sl_names) for o in hwa]}")
for o in ["FENG TAY", "YKK", "HWASEUNG", "SHOETOWN", "RAMATEX", "INTERLOOP"]:
    in_c = [c for c in ("adidas", "Nike") if o in OSITES[c]]
    print(f"  owner '{o}': owner of open sites for {in_c or 'neither (exact name not found)'}; "
          f"sites {[len(OSITES[c][o]) for c in in_c]}; in the GLEIF slice as an owner name: {o in sl_names}")

# ---------------------------------------------------------------------------------------------
section("13. Country boundary corrections: Vietnam 2025 (the one verified correction)")
vm = rows_of["vn_mapping"]
check("old provinces", 39, len({r["old_province_name_in_boundary_file"] for r in vm}))
check("new provinces", 23, len({r["new_province_2025"] for r in vm}))
out("MATCH" if all(c == 1 for c in Counter(r["old_province_name_in_boundary_file"] for r in vm).values()) else "DIFF",
    "no old province maps to two new ones (no split)")
out("INFO", f"change types: {dict(Counter(r['change'].split(' ')[0] for r in vm))} (prompt: 'whole provinces merged')")
vn = [r for r in ref if r["country_code"] == "VN"]; new = {"VN:" + r["new_province_2025"] for r in vm}
out("MATCH" if all(r["region_key"] in new for r in vn) else "DIFF",
    f"reference Vietnam region keys reproduced by the mapping: {sum(1 for r in vn if r['region_key'] in new)}/{len(vn)}")
for cust in DEMO:
    print(f"  {cust}: open sites in Vietnam {sum(1 for r in OPEN[cust] if r['country_code'] == 'VN')}")
out("OPEN", "whether countries other than Vietnam need boundary corrections is not checked")

# ---------------------------------------------------------------------------------------------
section("14. GLEIF slice and parents")
sl, par = rows_of["gleif_slice"], rows_of["gleif_par"]
lv = Counter(r["review_level"][:1] for r in sl)
check("GLEIF candidates", 440, len(sl)); check("level 1 / 2 / 3", "30 / 48 / 362", f"{lv['1']} / {lv['2']} / {lv['3']}")
flags = Counter(f.strip() for r in sl for f in r["flags"].split(";") if f.strip())
out("INFO", f"flag types not named in the prompt: {sorted(set(flags) - {'generic name', 'fund', 'sole proprietor', 'not active'})}")
out("INFO", f"slice brands: {dict(Counter(r['our_brands'] for r in sl))} (built from adidas and Nike names only)")
out("INFO", f"person verdicts filled in the slice (the one verdict column in the design): "
            f"{sum(1 for r in sl if r[next(c for c in r if c.startswith('person_verdict'))].strip())}/{len(sl)}")
pc_col = next((c for c in rows_of["gleif_par"][0] if c.startswith("person_confirmed")), None)
out("INFO", f"parents file column {pc_col!r} (not used by the design): filled "
            f"{sum(1 for r in rows_of['gleif_par'] if pc_col and r[pc_col].strip())}/{len(rows_of['gleif_par'])}")
per_name = {(r["kind"], r["our_names"]): int(r["our_sites"]) for r in sl}
open_an = [r for c in ("adidas", "Nike") for r in OPEN[c]]; open_an = list({r["os_id"]: r for r in open_an}.values())
def relink(owner_names_of):
    ok = 0
    for (kind, names), n in per_name.items():
        if kind == "owner":
            got = {r["os_id"] for r in open_an if basic(names) in owner_names_of(r)}
        else:
            want = {basic(x) for x in names.split(" | ")}
            got = {r["os_id"] for r in open_an if basic(r["name"]) in want}
        ok += len(got) == n
    return ok
changed("GLEIF re-link: names whose re-linked open-site count equals our_sites",
        f"{relink(lambda r: split_pipe(ref_by[r['os_id']]['parent_groups']))}/{len(per_name)}",
        f"{relink(lambda r: OWN['facilities'][r['os_id']])}/{len(per_name)}")
changed("GLEIF re-link (previous step 6 -> now)", f"{relink(lambda r: OWN_PREV['facilities'][r['os_id']])}/{len(per_name)}",
        f"{relink(lambda r: OWN['facilities'][r['os_id']])}/{len(per_name)}")
wp = [r for r in par if r["direct_parent_lei"]]
check("parents: rows / with a direct parent", "30 / 3", f"{len(par)} / {len(wp)}")
check("parent names (case ignored)", "COATS GROUP PLC, AVERY DENNISON CORPORATION, SAYE S.P.A.",
      ", ".join(r["direct_parent_name"] for r in wp).upper())
reasons = Counter(r["no_parent_reason"] for r in par if not r["direct_parent_lei"])
print(f"  no_parent_reason: {dict(reasons)}")
_codes = sum(v for k_, v in reasons.items() if re.fullmatch(r"[A-Z_]+", k_))
check("rows without a parent: GLEIF reason codes + other notes", "26 + 1", f"{_codes} + {sum(reasons.values()) - _codes}")
out("INFO", f"direct == ultimate parent for all rows with a parent: {all(r['direct_parent_lei'] == r['ultimate_parent_lei'] for r in wp)}")
out("OPEN", "the GLEIF lookup-list builder is not in the repo (parents now come from the relationship file, section 17b)")

# ---------------------------------------------------------------------------------------------
section("15. GDACS fixture (test only; adidas + Nike sites)")
gd = rows_of["gdacs"]
check("sites / adidas / Nike", "8 / 5 / 3",
      f"{len({r['os_id'] for r in gd})} / {sum(1 for r in gd if T(r['adidas']))} / {sum(1 for r in gd if T(r['nike_feb_2024']))}")
check("events, alert levels", "3, all Green", f"{len({r['gdacs_event'] for r in gd})}, "
      f"{'all Green' if {r['alert_level'] for r in gd} == {'Green'} else dict(Counter(r['alert_level'] for r in gd))}")
out("INFO", f"control site TR201909837HW3X in the fixture: "
            f"{[(r['gdacs_event'], r['gdacs_polygon_label']) for r in gd if r['os_id'] == 'TR201909837HW3X']}")
out("INFO", "Apple / Samsung hazard check (0 of their sites inside, 246 events) is from the prompt; the script "
            "cannot repeat it (no saved shapes, no network)")

# ---------------------------------------------------------------------------------------------
section("16. tools/gleif_slice.py (read, not run, not changed)")
src = open(FILES["gleif_tool"], encoding="utf-8").read()
print(f"  sha256: {hashlib.sha256(src.encode()).hexdigest()}")
print(f"  expects a lookup list named gleif_names_compact.csv or gleif_lookup_list.csv: "
      f"{'gleif_names_compact.csv' in src and 'gleif_lookup_list.csv' in src}; present in tools/: "
      f"{[p for p in ('gleif_names_compact.csv', 'gleif_lookup_list.csv') if os.path.exists(P('tools', p))] or 'none'}")

# ---------------------------------------------------------------------------------------------
section("17. Raw GLEIF file (header always; full stream unless --skip-gleif-stream)")
GLEIF_N = None
with open(FILES["gleif_raw"], newline="", encoding="utf-8") as f:
    ghead = next(csv.reader(f))
print(f"  header: {len(ghead)} columns: {ghead}")
out("MATCH" if not [h for h in ghead if re.search(r"parent|relationship|ultimate", h, re.I)] else "DIFF",
    "no parent/relationship columns in the header")
if "--skip-gleif-stream" in sys.argv:
    out("INFO", "record count and 'HI TECH' re-count skipped (--skip-gleif-stream)")
else:
    csv.field_size_limit(sys.maxsize)
    norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (s or "").upper())).strip()   # as in gleif_slice.py
    name_idx = [i for i, h in enumerate(ghead) if h == "Entity.LegalName" or re.match(
        r"^Entity\.(OtherEntityNames\.OtherEntityName|TransliteratedOtherEntityNames\.TransliteratedOtherEntityName)\.\d+$", h)]
    n = wrong = hi = 0
    with open(FILES["gleif_raw"], newline="", encoding="utf-8") as f:
        rd = csv.reader(f); next(rd)
        for row in rd:
            n += 1
            if len(row) != len(ghead): wrong += 1; continue
            if any(norm(row[i]).startswith("HI TECH ") for i in name_idx): hi += 1
    GLEIF_N = n
    check("GLEIF records", 3446215, n); check("GLEIF columns", 338, len(ghead))
    out("MATCH" if not wrong else "DIFF", f"rows with the wrong column count: {wrong}")
    check("'HI TECH' starts_with candidates", 215, hi)

# ---------------------------------------------------------------------------------------------
section("17b. GLEIF relationship file (parents), and the offline extracts made from it")
RRF = P("data", "raw", "gleif", "20260929-1600-gleif-goldencopy-rr-golden-copy.csv")
check("relationship file size in bytes", 243602048, os.path.getsize(RRF))
csv.field_size_limit(sys.maxsize)
S_, E_, T_, ST_ = ("Relationship.StartNode.NodeID", "Relationship.EndNode.NodeID",
                   "Relationship.RelationshipType", "Relationship.RelationshipStatus")
rr_types, rr_starts, rr_idtypes, rr_status, rr_status_company = Counter(), defaultdict(set), Counter(), Counter(), Counter()
rr_parent = defaultdict(dict)     # start LEI -> {type: end LEI}, for the three company types
COMPANY = {"IS_DIRECTLY_CONSOLIDATED_BY", "IS_ULTIMATELY_CONSOLIDATED_BY", "IS_INTERNATIONAL_BRANCH_OF"}
FUND = {"IS_FUND-MANAGED_BY", "IS_SUBFUND_OF", "IS_FEEDER_TO"}
our_leis = {r["LEI"] for r in rows_of["gleif_slice"]}
touch, rr_rows, rr_bad = 0, 0, 0
with open(RRF, newline="", encoding="utf-8") as f:
    rd = csv.reader(f); rhead = next(rd); col = {h: i for i, h in enumerate(rhead)}
    for row in rd:
        rr_rows += 1
        if len(row) != len(rhead): rr_bad += 1; continue
        st, en, ty = row[col[S_]], row[col[E_]], row[col[T_]]
        rr_types[ty] += 1; rr_starts[ty].add(st); rr_status[row[col[ST_]]] += 1
        if ty in COMPANY: rr_status_company[row[col[ST_]]] += 1
        rr_idtypes[(row[col["Relationship.StartNode.NodeIDType"]], row[col["Relationship.EndNode.NodeIDType"]])] += 1
        if ty in COMPANY: rr_parent[st][ty] = en
        if st in our_leis or en in our_leis: touch += 1
check("relationship file columns", 54, len(rhead))
check("relationship file rows / rows with the wrong column count", "489,389 / 0", f"{rr_rows:,} / {rr_bad}")
for c in [S_, E_, T_, ST_, "Registration.RegistrationStatus", "Relationship.Period.1.startDate"]:
    out("MATCH" if c in rhead else "DIFF", f"key column present: {c}")
out("INFO", f"name columns in the relationship file: {[h for h in rhead if 'name' in h.lower()] or 'none'} "
            "(parent names must come from the entity file)")
EXPECT_T = {"IS_FUND-MANAGED_BY": 151636, "IS_ULTIMATELY_CONSOLIDATED_BY": 133190, "IS_DIRECTLY_CONSOLIDATED_BY": 126982,
            "IS_SUBFUND_OF": 74227, "IS_INTERNATIONAL_BRANCH_OF": 1965, "IS_FEEDER_TO": 1389}
for t, n_ in EXPECT_T.items(): check(f"rows of type {t}", n_, rr_types.get(t, 0))
out("MATCH" if set(rr_types) == set(EXPECT_T) else "DIFF", f"relationship types in the file: {sorted(rr_types)}")
out("MATCH" if all(len(rr_starts[t]) == rr_types[t] for t in rr_types) else "DIFF",
    "distinct start nodes per type == rows per type (at most one record per entity per type): "
    f"{all(len(rr_starts[t]) == rr_types[t] for t in rr_types)}")
fund_rows = sum(rr_types[t] for t in FUND)
check("fund-type rows (FUND-MANAGED, SUBFUND, FEEDER) and share", "227,252 (46.4%)", f"{fund_rows:,} ({pct(fund_rows / rr_rows)})")
check("node ID types (start/end)", "all LEI/LEI", "all LEI/LEI" if set(rr_idtypes) == {("LEI", "LEI")} else str(dict(rr_idtypes)))
out("INFO", f"relationship status, all six types: {dict(rr_status)}")
check("relationship status, the 3 company types kept: ACTIVE / INACTIVE / NULL", "262,072 / 59 / 6",
      f"{rr_status_company.get('ACTIVE', 0):,} / {rr_status_company.get('INACTIVE', 0):,} / {rr_status_company.get('NULL', 0):,}")
out("INFO", f"other status values among the 3 company types: {sorted(set(rr_status_company) - {'ACTIVE', 'INACTIVE', 'NULL'}) or 'none'}")
ent_n = GLEIF_N if GLEIF_N else 3446215
check("direct-parent records / entities", "126,982 of 3,446,215 (3.7%)",
      f"{rr_types['IS_DIRECTLY_CONSOLIDATED_BY']:,} of {ent_n:,} ({pct(rr_types['IS_DIRECTLY_CONSOLIDATED_BY'] / ent_n)})")
out("INFO", "entity count " + ("counted by streaming the entity file (section 17)" if GLEIF_N else "taken from the prompt (stream skipped)"))
check("candidate LEIs in the slice", 418, len(our_leis))
check("relationship rows touching our candidate LEIs (start or end)", 188, touch)
check("rows in rr_for_our_leis.csv", 188, len(read_csv(P("data", "reference", "rr_for_our_leis.csv"))[1]))
lvl = defaultdict(set)
for r in rows_of["gleif_slice"]: lvl[r["LEI"]].add(r["review_level"][:1])
with_link = [l for l in our_leis if rr_parent.get(l)]
by_best = Counter(min(lvl[l]) for l in with_link)
out("INFO", f"candidate LEIs with more than one review level in the slice: {sum(1 for l in our_leis if len(lvl[l]) > 1)}")
check("candidates with a parent-type link: total, level 1 / 2 / 3 (best level per LEI)", "58: 3 / 16 / 39",
      f"{len(with_link)}: {by_best['1']} / {by_best['2']} / {by_best['3']}")
top_diff = [l for l in with_link if "IS_DIRECTLY_CONSOLIDATED_BY" in rr_parent[l] and "IS_ULTIMATELY_CONSOLIDATED_BY" in rr_parent[l]
            and rr_parent[l]["IS_DIRECTLY_CONSOLIDATED_BY"] != rr_parent[l]["IS_ULTIMATELY_CONSOLIDATED_BY"]]
top_only = [l for l in with_link if "IS_ULTIMATELY_CONSOLIDATED_BY" in rr_parent[l] and "IS_DIRECTLY_CONSOLIDATED_BY" not in rr_parent[l]]
check("candidates whose top parent differs from the direct parent", 15, len(top_diff))
check("candidates with only a top parent", 8, len(top_only))
def chain(lei, limit=5):
    path, seen, cur = [], {lei}, lei
    while len(path) < limit:
        nxt = rr_parent.get(cur, {}).get("IS_DIRECTLY_CONSOLIDATED_BY")
        if not nxt: break
        path.append(nxt)
        if nxt in seen: path.append("REPEAT"); break
        seen.add(nxt); cur = nxt
    return path
depths = Counter(len([x for x in chain(l) if x != "REPEAT"]) for l in with_link)
out("INFO", f"direct-parent hops followed upward (limit 5) for the {len(with_link)} candidates: {dict(sorted(depths.items()))}; "
            f"chains that hit a repeat: {sum(1 for l in with_link if 'REPEAT' in chain(l))}")
longest = max(depths)
check("longest direct-parent chain among the candidates with a parent link / any chain repeats (R7 says: at most 2 hops, no repeat)",
      "2 hops / False", f"{longest} hops / {any('REPEAT' in chain(l) for l in with_link)}")
out("INFO", f"longest direct-parent chain among the {len(with_link)} candidates with a parent link: {longest} hops; "
            f"any chain repeats: {any('REPEAT' in chain(l) for l in with_link)}; any chain reaches the 5-hop limit: "
            f"{any(len([x for x in chain(l) if x != 'REPEAT']) >= 5 for l in with_link)}")
par_rows = rows_of["gleif_par"]
likely = {r["LEI"] for r in par_rows}
lik_links = {l: rr_parent[l] for l in likely if rr_parent.get(l)}
check("likely matches with a parent in the relationship file", 3, len(lik_links))
api = {r["LEI"]: (r["direct_parent_lei"], r["ultimate_parent_lei"]) for r in par_rows if r["direct_parent_lei"]}
rrp = {l: (v.get("IS_DIRECTLY_CONSOLIDATED_BY", ""), v.get("IS_ULTIMATELY_CONSOLIDATED_BY", "")) for l, v in lik_links.items()}
out("MATCH" if api == rrp else "DIFF", f"relationship file vs gleif_parents_checked.csv (API, 2026-09-30), direct and top parent: same = {api == rrp}")
for l, (d, u) in sorted(rrp.items()):
    nm = next(r["direct_parent_name"] for r in par_rows if r["LEI"] == l)
    print(f"      {l} -> {d} ({nm}); top parent {u}; one level: {d == u}")
ch = rows_of_ch = read_csv(P("data", "reference", "rr_parent_chains.csv"))
chd = [dict(zip(ch[0], r)) for r in ch[1]]
c_direct = {r["likely_lei"]: r["to_lei"] for r in chd if r["hop"] == "1"}
out("MATCH" if c_direct == {l: d for l, (d, u) in api.items()} else "DIFF",
    f"rr_parent_chains.csv gives the same 3 direct parents as gleif_parents_checked.csv: {c_direct == {l: d for l, (d, u) in api.items()}}")
end_in_slice = sum(1 for l, (d, u) in rrp.items() if d in our_leis)
out("INFO", f"of those 3 parents, found as entities in the slice (so a name is on hand): {end_in_slice} of {len(rrp)}")
br = [l for l in with_link if "IS_INTERNATIONAL_BRANCH_OF" in rr_parent[l]]
check("candidates with an IS_INTERNATIONAL_BRANCH_OF link", 1, len(br))
for l in br:
    rows = [r for r in rows_of["gleif_slice"] if r["LEI"] == l]
    for r in rows:
        print(f"      branch link: our name {r['our_names']!r} -> {r['gleif_legal_name']!r} ({r['legal_country']}), "
              f"level {r['review_level'][:1]}, Entity.EntityCategory {r['entity_category']!r}")
    check("that record's Entity.EntityCategory in the entity file", "GENERAL", rows[0]["entity_category"] if rows else "")
src_rel = open(P("tools", "gleif_relationships.py"), encoding="utf-8").read()
m = re.search(r'LIKELY = set\("""(.*?)"""', src_rel, re.S)
hard = set(m.group(1).split()) if m else set()
out("INFO", f"tools/gleif_relationships.py hard-codes {len(hard)} likely LEIs; same as gleif_parents_checked.csv: {hard == likely}")
out("INFO", "tools/gleif_relationships.py reads 'gleif_slice.csv' and writes its outputs in its own folder: "
            f"{'gleif_slice.csv' in src_rel and 'HERE' in src_rel}; present in tools/: {os.path.exists(P('tools', 'gleif_slice.csv'))}")

# ---------------------------------------------------------------------------------------------
section("18. Scale arithmetic (inputs from the prompt) and optional geo-service schema")
rows_open = sum(len(OPEN[c]) for c in DEMO)
print(f"  open site rows per customer: " + " + ".join(f"{c} {len(OPEN[c])}" for c in DEMO) + f" = {rows_open:,}")
check("open site rows, all demo customers", 2327, rows_open)
check("50 x open site rows", 116350, 50 * rows_open)
print(f"  50 x {rows_open:,} = {50 * rows_open:,}; / 5,000 per year = {50 * rows_open / 5000:.2f} years")
print(f"  distinct open sites (a site on two customers' lists counted once): {len({x for c in DEMO for x in ids[c]}):,}")
print(f"  earlier basis: 50 x 1,536 = {50 * 1536:,} sites; / 5,000 per year = {50 * 1536 / 5000:.2f} years")
print(f"  50 x 440 GLEIF candidate rows = {50 * 440:,}")
print(f"  demo rows loaded today: {len(fac)} + {len(rows_of['apple'])} + {len(rows_of['samsung'])} = "
      f"{len(fac) + len(rows_of['apple']) + len(rows_of['samsung'])}")
if "--geo-schema" in sys.argv and sys.argv.index("--geo-schema") + 1 < len(sys.argv):
    gpath = sys.argv[sys.argv.index("--geo-schema") + 1]
    lines = open(gpath, encoding="utf-8").read().splitlines()
    for i, l in enumerate(lines, 1):
        if "enable_extension" in l: print(f"  schema line {i}: {l.strip()}")
    print(f"  schema lines mentioning jsonb: {sum(1 for l in lines if 'jsonb' in l)}; "
          f"mentions postgis: {any('postgis' in l.lower() for l in lines)}")

# ---------------------------------------------------------------------------------------------
section("19. MVP demo table (README.md, Demo data)")
CUSTS = ["adidas", "Nike", "Apple", "Samsung"]
row = lambda f: " | ".join(f(c) for c in CUSTS)
check("Open sites", "766 | 625 | 749 | 187", row(lambda c: str(len(OPEN[c]))))
check("Share basis", "workers | workers | sites | sites", row(lambda c: BASIS[c]))
def top_country(c):
    g, v = max(COUNTRY[c].items(), key=lambda x: x[1]); return f"{g} {pct(v)}"
check("Largest country", "VN 31.5% | VN 40.6% | CN 45.9% | KR 31.0%", row(top_country))
check("Countries at High", "3 | 3 | 2 | 4", row(lambda c: str(levels(COUNTRY[c])[0])))
def top_owner(c):
    o, v = max(OSH[c].items(), key=lambda x: x[1])
    lvl = "High" if v >= .10 else "Watch" if v >= .05 else ""
    if BASIS[c] == "workers": return f"{o} {pct(v)}" + (f" ({lvl})" if lvl else "")
    return f"{o}, {len(OSITES[c][o])} sites ({pct(v)})" + (f" {lvl}" if lvl else "")
check("Largest owner (on the share basis)", "POU CHEN 7.4% (Watch) | FENG TAY 9.3% (Watch) | INTEL, 9 sites (1.2%) | HITACHI, 9 sites (4.8%)",
      row(top_owner))
fix_ids = {r["os_id"]: r["alert_level"] for r in rows_of["gdacs"]}
def dis(c):
    hit = [fix_ids[r["os_id"]] for r in OPEN[c] if r["os_id"] in fix_ids]
    return f"{len(hit)} ({'/'.join(sorted(set(hit)))})" if hit else "0"
check("Sites inside a current disaster area (GDACS fixture, 2026-09-30)", "5 (Green) | 3 (Green) | 0 | 0", row(dis))
out("INFO", "Apple and Samsung 0: the fixture holds adidas and Nike sites only; the one-time check against 246 current events "
            "also found 0")
check("GLEIF likely matches / with a parent", "30 / 3",
      f"{sum(1 for r in rows_of['gleif_slice'] if r['review_level'].startswith('1'))} / {sum(1 for r in rows_of['gleif_par'] if r['direct_parent_lei'])}")
check("owner known for Apple (the rule example in section 5)", "66 of 749",
      f"{sum(1 for r in OPEN['Apple'] if OWN['apple'][r['os_id']])} of {len(OPEN['Apple'])}")
check("50x open site rows (ARCHITECTURE.md, section 7)", "2,327 -> 116,350", f"{sum(len(OPEN[c]) for c in CUSTS):,} -> {50 * sum(len(OPEN[c]) for c in CUSTS):,}")
check("GLEIF review rows at 50x (ARCHITECTURE.md, section 7)", "440 -> 22,000", f"{len(rows_of['gleif_slice'])} -> {50 * len(rows_of['gleif_slice']):,}")

section("20. Numbers that other sections do not print (adidas list counts: ASSUMPTIONS.md #4)")
lt = Counter(ad_type(r) for r in OPEN["adidas"])
check("adidas list names: Primary / Licensee / Wet Process Suppliers (open sites)", "438 / 194 / 134",
      f"{lt['primary']} / {lt['licensee']} / {lt['wet process']}")
check("adidas open sites without a worker estimate", 47, sum(1 for r in OPEN["adidas"] if workers(r) is None))

# ---------------------------------------------------------------------------------------------
section("SUMMARY")
print(f"  {len(DIFFS)} unexpected differences")
for name, items in (("unexpected differences", DIFFS),
                    ("expected differences from the old reference file", EXPECTED),
                    ("numbers changed by the written owner rule", CHANGED), ("open items raised", OPENS)):
    print(f"  {name}: {len(items)}")
    for x in items: print(f"    - {x}")
