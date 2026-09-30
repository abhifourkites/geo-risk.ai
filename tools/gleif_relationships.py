#!/usr/bin/env python3
"""
Read GLEIF's relationship file (Level 2) and report what it holds for our candidate companies.

Inputs (same folder as this script):
  20260929-1600-gleif-goldencopy-rr-golden-copy.csv   GLEIF relationship file (or pass a path as the first argument)
  gleif_slice.csv                                     our name-match candidates (column "LEI")
Output (same folder):
  rr_summary.txt          counts for the whole file, and for our candidates
  rr_for_our_leis.csv     every relationship where one of our candidate LEIs is the start or the end node
  rr_parent_chains.csv    for our 30 likely matches: parent chains followed upward, hop by hop

Nothing is guessed: every relationship type found is counted, and chains stop at 5 hops or at a repeat.
Standard library only.
"""
import csv, glob, os, sys, time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
_found = sorted(glob.glob(os.path.join(HERE, "*-gleif-goldencopy-rr-golden-copy.csv")))
RR = sys.argv[1] if len(sys.argv) > 1 else (_found[-1] if _found else "")
SLICE = os.path.join(HERE, "gleif_slice.csv")
# the 30 "level 1 - likely" matches, from our review of the slice (checked 2026-09-30)
LIKELY = set("""335800KLZHM57TVMVE51 254900C13OP0T2U21288 4469000001E9305R6057 335800B6VWRQKKS8ET90 9845004EXF9FF96ZE069
335800YEJVLU97Q3AO26 984500EA78DHC8D7A753 815600B993FE0C0EE660 4851007XP81MRKDGOG83 655600NR25VCW1L3DZ64 254900UYFT8SIXMAUK60
549300V8APX7RQY6KX08 894500Q3ZZQSEGFWJY19 335800L1XBZGUOB27Z75 335800TJRI6JIU27WG38 549300GNRRGYURBT4F36 213800RPETDKTYGMQP66
254900UXECELWPPCMF59 213800TIMLY8NHYC2I61 254900IJ5CIKQUWRVK82 549300YDGYNJ5OSNWF92 655600MUYCKJJ5U0N311 65560029PAC6WJFOYY38
655600OVRR5I3OJRFF23 8156005B22B0857C7357 549300X006DP42WTYN30 894500H4I6Y82QRREF57 5493005I5BINLWKGQO91 984500EDZ3A60C0RD904
391200G6XHT7VDQ18P07""".split())
PARENT_TYPES = {"IS_DIRECTLY_CONSOLIDATED_BY", "IS_ULTIMATELY_CONSOLIDATED_BY", "IS_INTERNATIONAL_BRANCH_OF"}
S, E, T, ST = "Relationship.StartNode.NodeID", "Relationship.EndNode.NodeID", "Relationship.RelationshipType", "Relationship.RelationshipStatus"
KEEP = [S, "Relationship.StartNode.NodeIDType", E, "Relationship.EndNode.NodeIDType", T, ST,
        "Relationship.Period.1.startDate", "Relationship.Period.1.endDate", "Relationship.Period.1.periodType",
        "Registration.RegistrationStatus", "Registration.LastUpdateDate", "Registration.ValidationSources"]

def main():
    if not RR or not os.path.exists(RR): sys.exit("relationship file not found in " + HERE)
    if not os.path.exists(SLICE): sys.exit("gleif_slice.csv not found in " + HERE)
    with open(SLICE, newline="", encoding="utf-8") as f:
        ours = {r["LEI"] for r in csv.DictReader(f) if r.get("LEI")}
    missing_likely = LIKELY - ours
    print(f"relationship file: {RR}\nour candidate LEIs: {len(ours)} | likely LEIs not in the slice: {len(missing_likely)}")
    csv.field_size_limit(sys.maxsize)
    n = 0; bad = 0; types = Counter(); status = Counter(); reg = Counter(); idtype = Counter(); t0 = time.time()
    starts_by_type = defaultdict(set)
    parent = defaultdict(list)                      # start -> [(end, type, status)] for the 3 parent types
    ours_rows = []
    with open(RR, newline="", encoding="utf-8") as f:
        rd = csv.reader(f); head = next(rd); col = {h: i for i, h in enumerate(head)}
        miss = [c for c in KEEP if c not in col]
        if miss: sys.exit("columns not found: " + ", ".join(miss))
        for row in rd:
            n += 1
            if len(row) != len(head): bad += 1; continue
            s, e, t, st = row[col[S]], row[col[E]], row[col[T]], row[col[ST]]
            types[t] += 1; status[(t, st)] += 1; reg[row[col["Registration.RegistrationStatus"]]] += 1
            idtype[(row[col["Relationship.StartNode.NodeIDType"]], row[col["Relationship.EndNode.NodeIDType"]])] += 1
            starts_by_type[t].add(s)
            if t in PARENT_TYPES: parent[s].append((e, t, st))
            if s in ours or e in ours: ours_rows.append([row[col[c]] for c in KEEP] + ["start" if s in ours else "end"])
            if n % 100000 == 0: print(f"  {n:,} rows, {time.time() - t0:.0f}s")
    with open(os.path.join(HERE, "rr_for_our_leis.csv"), "w", newline="", encoding="utf-8") as o:
        w = csv.writer(o); w.writerow(KEEP + ["our_lei_is"]); w.writerows(ours_rows)
    # chains for the likely matches: follow the DIRECT parent upward, hop by hop
    chains = []
    for lei in sorted(LIKELY):
        cur, seen, hop = lei, {lei}, 0
        ult = [x for x in parent.get(lei, []) if x[1] == "IS_ULTIMATELY_CONSOLIDATED_BY"]
        br = [x for x in parent.get(lei, []) if x[1] == "IS_INTERNATIONAL_BRANCH_OF"]
        if not parent.get(lei):
            chains.append([lei, 0, "", "", "", "no parent-type relationship in the file"])
        while hop < 5:
            d = [x for x in parent.get(cur, []) if x[1] == "IS_DIRECTLY_CONSOLIDATED_BY"]
            if not d: break
            nxt = d[0]; hop += 1
            chains.append([lei, hop, nxt[0], nxt[1], nxt[2], f"{len(d)} direct parent record(s) at this hop"])
            if nxt[0] in seen: chains.append([lei, hop, nxt[0], "", "", "stopped: repeat"]); break
            seen.add(nxt[0]); cur = nxt[0]
        for x in ult: chains.append([lei, "ultimate", x[0], x[1], x[2], ""])
        for x in br: chains.append([lei, "branch", x[0], x[1], x[2], ""])
    with open(os.path.join(HERE, "rr_parent_chains.csv"), "w", newline="", encoding="utf-8") as o:
        w = csv.writer(o); w.writerow(["likely_lei", "hop", "to_lei", "relationship_type", "relationship_status", "note"]); w.writerows(chains)
    by_ours = Counter(r[4] for r in ours_rows if r[-1] == "start")
    lines = [f"rows read: {n:,} | rows with wrong column count: {bad}",
             "relationship types (rows): " + "; ".join(f"{k} {v:,}" for k, v in types.most_common()),
             "distinct START nodes per type: " + "; ".join(f"{k} {len(v):,}" for k, v in sorted(starts_by_type.items(), key=lambda x: -len(x[1]))),
             "type + status: " + "; ".join(f"{k[0]}/{k[1]} {v:,}" for k, v in sorted(status.items())),
             "registration status: " + "; ".join(f"{k} {v:,}" for k, v in reg.most_common()),
             "node ID types (start/end): " + "; ".join(f"{k[0]}/{k[1]} {v:,}" for k, v in idtype.most_common()),
             f"rows touching our {len(ours)} candidate LEIs: {len(ours_rows)} | our LEI as start, by type: " + "; ".join(f"{k} {v}" for k, v in by_ours.most_common()),
             f"our candidate LEIs that are a START node of any parent type: {len({r[0] for r in ours_rows if r[-1] == 'start' and r[4] in PARENT_TYPES})}",
             f"of the 30 likely matches, with any parent-type relationship: {sum(1 for l in LIKELY if parent.get(l))}",
             f"time: {time.time() - t0:.0f}s"]
    open(os.path.join(HERE, "rr_summary.txt"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines)); print("written: rr_summary.txt, rr_for_our_leis.csv, rr_parent_chains.csv")

if __name__ == "__main__":
    main()
