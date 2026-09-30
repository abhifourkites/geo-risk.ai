# Geographic Supplier Risk Intelligence

> Written before the build. Sections marked `[fill after build]` are completed from the working system.

## 1. What it is

- **What it does:** a company uploads its supplier list and sees, on a map, where its suppliers are concentrated, which owner companies hold many of its sites, and which sites sit inside a current disaster area.
- **Who uses it:** the company's own team: "Procurement Managers, Supply Chain Risk Analysts and Strategic Sourcing Managers", plus the CPO, who "wants a single answer about where the company is exposed".
- **What it uses:** the Open Supply Hub file (uploaded), GLEIF's entity and relationship files (offline), and GDACS disaster alerts (live).

## 2. What it does

| Part of the problem statement | In the MVP |
|---|---|
| Supplier risk concentration on an interactive map | ✅ Each country's share of the company's sites (or estimated workers), marked High or Watch |
| Single-source dependency | ✅ As **owner dependency**: owner companies that hold a large share of the sites. The data has no materials, so it cannot be done by material |
| Risk overlays on a global network map | ✅ Current disaster areas (GDACS), site warnings, and links site → owner → parent company |
| Alternative supplier identification | ❌ Not built: the data does not say what each site makes |

Location is shown by country only. A Vietnam 2025 province mapping is in the repo: prepared, not used in the MVP.

## 3. Demo data

The demo uses the public supplier lists of **adidas, Nike, Apple and Samsung** from Open Supply Hub. We do not claim they are FourKites customers.

| | adidas | Nike | Apple | Samsung |
|---|---|---|---|---|
| Open sites | 766 | 625 | 749 | 187 |
| Share basis | workers | workers | sites | sites |
| Largest country | VN 31.5% | VN 40.6% | CN 45.9% | KR 31.0% |
| Countries at High | 3 | 3 | 2 | 4 |
| Largest owner | POU CHEN 7.4% (Watch) | FENG TAY 9.3% (Watch) | INTEL, 9 sites (1.2%) | HITACHI, 9 sites (4.8%) |
| Sites inside a current disaster area | 5 (Green) | 3 (Green) | 0 | 0 |

**GLEIF:** 30 likely name matches (from the adidas and Nike names). 3 have a parent company in GLEIF: Coats Group PLC, Avery Dennison Corporation and SAYE S.P.A. A match is shown only after a person confirms it.

## 4. What works

`[fill after build — only features tested on the final build]`

## 5. What does not work / not built

| Not built | Why |
|---|---|
| Alternative suppliers | The data does not say what each site makes |
| Single-source by material | No material data |
| Product grouping | Product words are merged across every contributor, so they are shown only as information |
| Supplier-to-supplier links | The data does not say which site supplies which |
| Tier labels | adidas's and Nike's lists do not define tiers, and the Apple and Samsung list names do not mention them. Each list's own name is shown instead |
| Near-real-time supplier lists | Lists are only as fresh as their publishers make them |
| Performance trends | No supplier performance data |
| Per-company login | Demo only |

Raw-material tracing needs the company's own supplier data: supplier, location, material or part, and which site it supplies.

## 6. Known limits

- **Every number shows its base**, for example "owner known for 66 of 749 sites".
- **Owner names are not merged by spelling.** Nike's 3 "SHAHI" sites and adidas's 4 "SHAHI EXPORTS" sites count as different owners.
- **Lists are dated:** Apple 2019, Samsung 2021, Nike February 2024 (adidas January and April 2026).
- **GDACS alerts are automatic** and not reviewed by people. Confirm them before making decisions. Source: Global Disaster Awareness and Coordination System, GDACS.

## 7. How to run from a clean clone

`[fill after build]`

## 8. Hours spent

`[fill after build]`
