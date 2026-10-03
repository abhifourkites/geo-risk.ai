# Assumptions

For each gap in the brief: what was unclear, what we decided, why, and what would change our mind. Input figures are checked by `scripts/verify_inputs.py`; counts under our rating rules come from the app (`backend/app/rating.py`).

## 1. GLEIF parent records "track the entity count fairly closely"

This is the gap that, taken at face value, would have led us somewhere quietly wrong.

- **Unclear:** the brief says the relationship file has "broadly one parent record per registered entity, so expect the edge count to track the entity count fairly closely".
- **Decided:** use GLEIF only to confirm a parent company where one is recorded, never as the main source of owners.
- **Why:** in the 29 Sep 2026 files, only 126,982 direct-parent records exist for 3,446,215 entities (3.7%), and 46.4% of the 489,389 relationship records are fund links, not company parents. Of the GLEIF file's 30 likely matches, only 3 have a parent; under our rules, 33 candidates are likely (32 LEIs), and 5 of those LEIs have a parent record.
- **Would change our mind:** GLEIF parent coverage for most of our matched companies.

## 2. Open Supply Hub as "optional enrichment, not a foundation"

- **Unclear:** the brief says to treat Open Supply Hub as optional, but this outcome is about where production happens.
- **Decided:** Open Supply Hub is the foundation.
- **Why:** it is the only source in the brief with production-site locations. GLEIF holds legal and headquarters addresses; FMCSA covers carriers, which the glossary separates from suppliers.
- **Would change our mind:** another source of production locations without the 5,000-a-year download cap, or the company's own supplier data.

## 3. "Near real time" freshness, with dated lists

- **Unclear:** the brief asks for near-real-time data on a daily cycle, but supplier lists change only when companies publish them.
- **Decided:** disasters are refreshed live from GDACS; supplier lists change only by upload. The screen shows the time of the last GDACS refresh and each site's list names, which carry the list's year.
- **Why:** the lists are dated (Apple 2019, Samsung 2021, Nike February 2024, adidas January and April 2026), and the free download cap is 5,000 locations a year.
- **Would change our mind:** a supplier data feed that updates daily.

## 4. "Supplier" means a company that sells to you directly

- **Unclear:** the glossary says "Your Tier 1 suppliers sell to you directly", but list names such as adidas's Primary (438 sites), Licensee (194) and Wet Process Suppliers (134; each site counted once, by its first list) do not say whether a site sells to the company directly.
- **Decided:** show each list's own name; never label a site "Tier 1" or "Tier 2".
- **Why:** adidas's and Nike's lists do not define tiers, and Apple's and Samsung's list names do not mention them. We would be guessing.
- **Would change our mind:** the company's own definition of each list.

## 5. Whose supply chain

- **Unclear:** the brief describes a Chief Procurement Officer at a large manufacturer, but gives no company's supplier data.
- **Decided:** each company sees its own suppliers. adidas, Nike, Apple, Samsung and Amazon are demo stand-ins, used because their lists are public on Open Supply Hub; we do not claim they are FourKites customers.
- **Why:** real, published supplier lists rather than a made-up customer. The users are the company's own team.
- **Would change our mind:** a company's own supplier list, which would go through the same upload.

## 6. Alternative supplier identification, with no product data

- **Unclear:** the outcome promises "alternative supplier identification", but the brief does not say what data shows that one site can replace another.
- **Decided:** not built, and stated in the README.
- **Why:** an alternative must make the same thing, and the data does not say what each site makes. adidas's lists give no product words, Nike's only broad ones, and the download merges every contributor's words. Facility type is too broad: 747 of 850 open adidas and Nike sites that have one say "Final Product Assembly".
- **Would change our mind:** the company supplying what each site makes.

## 7. Single-source dependency, with no material data

- **Unclear:** the glossary defines single-source dependency as "a material or component available from only one supplier, or from several suppliers who all depend on the same upstream source". The data has no materials.
- **Decided:** show owner dependency instead, labelled so: owners holding a large share of the sites, and owners with all their sites in one country.
- **Why:** it matches the definition's second half: sites that all depend on one owner company. The owner is the only shared dependency the data records, and the brief names the risk itself: "a corporate group collapses". The owner is known for 71.9% of adidas sites and 100% of Nike sites.
- **Would change our mind:** material or component data per site, or supplier-to-supplier links.

## 8. What counts as "risk concentration"

- **Unclear:** the brief gives no threshold.
- **Decided:** High at 10% or more in one country or under one owner, Watch at 5%, by share of estimated workers (or of sites when workers are known for less than 90% of open sites). Both thresholds are shown and can be changed on screen.
- **Why:** at 10% alone no owner is flagged for adidas or Nike, hiding Feng Tay's 9.3% of Nike's workers; at 3%, up to 10 owners are flagged, too many to act on. Workers rather than sites, because sites differ in size: Dong Nai has 5.4% of Nike's sites but 13.5% of its workers.
- **Would change our mind:** a threshold the company's risk team already uses.

## 9. The outcome text differs between the brief and FourKites' inventory

- **Unclear:** FourKites' outcome inventory also lists "historical performance trends by region" for this outcome; the brief's text does not.
- **Decided:** follow the brief's text; performance trends are not built.
- **Why:** there is no supplier performance data.
- **Would change our mind:** performance data per supplier, such as delivery records.
