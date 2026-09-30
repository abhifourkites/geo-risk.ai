#!/usr/bin/env python3
"""
Slice the GLEIF golden copy down to the records relevant to our adidas / Nike data.

Inputs (same folder as this script, or ~/Downloads for the lookup list):
  20260923-0800-gleif-goldencopy-lei2-golden-copy.csv   GLEIF Level 1 file (3.6 GB)
  gleif_lookup_list.csv                                 817 owner names + 1,297 site names from our data

Matching (nothing guessed, every row labelled):
  exact        GLEIF name == our name after the same clean-up used to build the lookup list
               (upper case, punctuation -> space, spaces collapsed)
  starts_with  GLEIF name begins with our name followed by more words; only for our names of 2+ words.
               These are CANDIDATES for a person to review, not matches.
Names checked in GLEIF: Entity.LegalName, OtherEntityName.1-5, TransliteratedOtherEntityName.1-5.
Country is NOT used as a filter; country_match says whether GLEIF's legal or HQ country is one of
the countries where our sites are.
GLEIF records ownership/identity, never supply.

Output (same folder): gleif_slice.csv, gleif_slice_summary.txt
Run:  python3 /Users/abhinav.gupta/service/gleif/gleif_slice.py
Standard library only.
"""
import csv, glob, os, re, sys, time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
_found = sorted(glob.glob(os.path.join(HERE, "*-gleif-goldencopy-lei2-golden-copy.csv")))
GLEIF = sys.argv[1] if len(sys.argv) > 1 else (_found[-1] if _found else os.path.join(HERE, "20260923-0800-gleif-goldencopy-lei2-golden-copy.csv"))
LOOKUP_CANDIDATES = [os.path.join(HERE, "gleif_names_compact.csv"), os.path.join(HERE, "gleif_lookup_list.csv"),
                     os.path.expanduser("~/Downloads/gleif_lookup_list.csv")]
OUT = os.path.join(HERE, "gleif_slice.csv")
SUMMARY = os.path.join(HERE, "gleif_slice_summary.txt")
STARTS_WITH_CAP = 25          # at most this many starts_with rows kept per name of ours (total still counted)

def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (s or "").upper())).strip()

def main():
    lookup_path = next((p for p in LOOKUP_CANDIDATES if os.path.exists(p)), None)
    if not lookup_path:
        sys.exit("gleif_lookup_list.csv not found. Put it in " + HERE + " or ~/Downloads.")
    if not os.path.exists(GLEIF):
        sys.exit("GLEIF file not found: " + GLEIF)

    ours = defaultdict(list)               # normalized name -> our rows
    by_two_words = defaultdict(set)        # first two words -> our normalized names (2+ words only)
    with open(lookup_path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            n = r["normalized_name"]
            ours[n].append(r)
            w = n.split()
            if len(w) >= 2:
                by_two_words[" ".join(w[:2])].add(n)
    print(f"lookup list: {lookup_path} | distinct names {len(ours)}")
    print(f"GLEIF file: {GLEIF}")

    csv.field_size_limit(sys.maxsize)
    out_cols = ["match_type", "gleif_name_field", "kind", "name_in_our_data", "our_countries", "our_sites", "our_brands",
                "LEI", "gleif_matched_name", "gleif_legal_name", "legal_city", "legal_region", "legal_country",
                "hq_city", "hq_country", "entity_status", "registration_status", "entity_category", "country_match"]
    rows_read = exact_rows = sw_rows = 0
    bad_rows, bad_examples, max_len = 0, [], 0
    sw_total = defaultdict(int)
    exact_names, t0 = set(), time.time()
    with open(GLEIF, newline="", encoding="utf-8") as f, open(OUT, "w", newline="", encoding="utf-8") as o:
        rd = csv.reader(f)
        head = next(rd)
        col = {h: i for i, h in enumerate(head)}
        need = ["LEI", "Entity.LegalName", "Entity.LegalAddress.City", "Entity.LegalAddress.Region", "Entity.LegalAddress.Country",
                "Entity.HeadquartersAddress.City", "Entity.HeadquartersAddress.Country", "Entity.EntityStatus",
                "Registration.RegistrationStatus", "Entity.EntityCategory"]
        missing = [c for c in need if c not in col]
        if missing:
            sys.exit("GLEIF columns not found: " + ", ".join(missing))
        name_cols = [("LegalName", col["Entity.LegalName"])] + [
            (h.split(".", 1)[1], i) for h, i in col.items()
            if re.match(r"^Entity\.(OtherEntityNames\.OtherEntityName|TransliteratedOtherEntityNames\.TransliteratedOtherEntityName)\.\d+$", h)]
        print(f"GLEIF name columns checked: {len(name_cols)}")
        w = csv.writer(o); w.writerow(out_cols)
        for row in rd:
            rows_read += 1
            if rows_read % 500000 == 0:
                print(f"  {rows_read:,} rows read, {exact_rows} exact, {sw_rows} starts_with kept, {time.time() - t0:.0f}s")
            if len(row) != len(head):
                bad_rows += 1
                max_len = max(max_len, len(row))
                if len(bad_examples) < 5:
                    bad_examples.append(f"row {rows_read}: {len(row)} columns, starts {row[0][:20] if row else ''}")
            if len(row) < len(head):
                continue
            g = lambda c: row[col[c]]
            countries = {g("Entity.LegalAddress.Country"), g("Entity.HeadquartersAddress.Country")} - {""}
            seen = set()
            for field, i in name_cols:
                n = norm(row[i])
                if not n:
                    continue
                hits = [("exact", n)] if n in ours else []
                wds = n.split()
                if len(wds) >= 3:
                    for cand in by_two_words.get(" ".join(wds[:2]), ()):
                        if n != cand and n.startswith(cand + " "):
                            hits.append(("starts_with", cand))
                for mtype, key in hits:
                    for r in ours[key]:
                        k = (mtype, r["kind"], key)
                        if k in seen:
                            continue
                        seen.add(k)
                        if mtype == "starts_with":
                            sw_total[(r["kind"], key)] += 1
                            if sw_total[(r["kind"], key)] > STARTS_WITH_CAP:
                                continue
                            sw_rows += 1
                        else:
                            exact_rows += 1
                            exact_names.add((r["kind"], key))
                        ours_c = set(filter(None, r.get("countries", "").split("|")))
                        w.writerow([mtype, field, r["kind"], r.get("name_in_our_data", key), r.get("countries", ""), r.get("sites", ""), r.get("brands", ""),
                                    g("LEI"), row[i], g("Entity.LegalName"), g("Entity.LegalAddress.City"), g("Entity.LegalAddress.Region"),
                                    g("Entity.LegalAddress.Country"), g("Entity.HeadquartersAddress.City"), g("Entity.HeadquartersAddress.Country"),
                                    g("Entity.EntityStatus"), g("Registration.RegistrationStatus"), g("Entity.EntityCategory"),
                                    ("yes" if countries & ours_c else "no") if ours_c else ""])
    capped = {k: v for k, v in sw_total.items() if v > STARTS_WITH_CAP}
    lines = [f"GLEIF rows read: {rows_read:,}",
             f"rows with the wrong number of columns (header has {len(head)}): {bad_rows:,} | longest row: {max_len} columns | examples: " + "; ".join(bad_examples),
             f"exact match rows: {exact_rows} | our names with an exact match: owners {sum(1 for k in exact_names if k[0] == 'owner')}, sites {sum(1 for k in exact_names if k[0] == 'site')}",
             f"starts_with candidate rows kept: {sw_rows} | our names with candidates: {len(sw_total)} | names over the cap of {STARTS_WITH_CAP}: {len(capped)}",
             "names over the cap (total candidates): " + "; ".join(f"{k[1]} ({v})" for k, v in sorted(capped.items(), key=lambda x: -x[1])[:40]),
             f"time: {time.time() - t0:.0f}s"]
    open(SUMMARY, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines)); print("written:", OUT, "and", SUMMARY)

if __name__ == "__main__":
    main()
