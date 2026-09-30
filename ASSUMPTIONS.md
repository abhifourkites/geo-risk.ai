# Assumptions

For each point where the brief was unclear: what was unclear, what we decided, why, and what we would need to know to decide differently. Every number below is checked by `scripts/verify_inputs.py`.

---

## 1. GLEIF parent records "track the entity count fairly closely"

**This is the gap that, taken at face value, would have led us somewhere quietly wrong.** The brief warns that at least one gap "if you take the brief at face value, will lead you somewhere quietly wrong".

- **Unclear:** The brief says GLEIF's relationship file is "broadly one parent record per registered entity, so expect the edge count to track the entity count fairly closely".
- **Decided:** Use GLEIF only to confirm a parent company where one is recorded, never as the main source of owners.
- **Why:** The edge count does not track the entity count. In the 29 Sep 2026 files:
  - only **126,982** direct-parent records exist for **3,446,215** entities (**3.7%**);
  - **46.4%** of the 489,389 relationship records are fund links (fund manager, sub-fund, feeder), not company parents;
  - of our 30 likely matches, only **3** have a parent.
- **Would change our mind:** GLEIF parent coverage for most of our matched companies.

## 2. Open Supply Hub as "optional enrichment, not a foundation"

- **Unclear:** The brief says to treat Open Supply Hub as optional, but this outcome is about where production happens.
- **Decided:** Use Open Supply Hub as the foundation.
- **Why:** It is the only source in the brief with **production site locations**. GLEIF holds legal and headquarters addresses, and FMCSA covers carriers, which the glossary separates from suppliers.
- **Would change our mind:** Another source of production locations without the 5,000-a-year download cap, or the company's own supplier data.

## 3. "Near real time" freshness, with dated lists

- **Unclear:** The brief asks for near-real-time data on a daily cycle, but supplier lists are only updated when companies publish them.
- **Decided:** Hazards are refreshed live from GDACS. Supplier lists are updated only by upload, and the screen shows the date of every source.
- **Why:** The lists are dated: Apple 2019, Samsung 2021, Nike February 2024, and adidas January and April 2026. The free download cap is 5,000 locations a year.
- **Would change our mind:** A supplier data feed that updates daily.

## 4. "Supplier" means a company that sells to you directly

- **Unclear:** The glossary says "Your Tier 1 suppliers sell to you directly". adidas publishes three lists (Primary, Licensee, Wet Process Suppliers), and their names do not say whether each site sells to adidas directly.
- **Decided:** Show each list's own name. Never label a site "Tier 1" or "Tier 2".
- **Why:** Neither adidas's nor Nike's lists define tiers, and the Apple and Samsung list names do not mention tiers. We would be guessing.
- **Would change our mind:** The company's own definition of each list.

## 5. Whose supply chain

- **Unclear:** The brief says FourKites' customers "are large shippers, manufacturers and retailers", and describes a Chief Procurement Officer at a large manufacturer. It gives no company's supplier data.
- **Decided:**
  - Each company sees **its own** suppliers.
  - adidas, Nike, Apple and Samsung are **demo stand-ins**, used because their supplier lists are public on Open Supply Hub. We do not claim they are FourKites customers.
- **Why:** These are real, published supplier lists, rather than a made-up customer. The users are the company's own team.
- **Would change our mind:** A company's own supplier list. It would go through the same upload.

## 6. Alternative supplier identification, with no product data

- **Unclear:** The outcome promises "alternative supplier identification", but the brief does not say what data should show that one site can replace another.
- **Decided:** Not built. Stated in the README.
- **Why:** An alternative supplier must make the same thing, and the data does not say what each site makes.
  - adidas's lists give no product words.
  - Nike's give only broad ones (APPAREL, FOOTWEAR, MATERIALS, EQUIPMENT).
  - The download merges all contributors' product words together.
  - Facility type is too broad: 747 of 850 open adidas and Nike sites that have one list "Final Product Assembly". Apple's and Samsung's files have no facility type.
- **Would change our mind:** The company supplying the products or parts made at each site.

## 7. Single-source dependency, with no material data

- **Unclear:** The brief defines single-source dependency by material or component. It does not say what to do when no material data exists.
- **Decided:** Show **owner dependency** instead, clearly labelled as such:
  - owners holding many sites or a large share;
  - owners with all their sites in one country.
- **Why:** The owner is the only shared dependency the data records. The brief names this risk itself: "a corporate group collapses". Owner is known for 72.1% of adidas sites and 100.0% of Nike sites.
- **Would change our mind:** Material or component data per site, or supplier-to-supplier links.

## 8. What counts as "risk concentration"

- **Unclear:** The brief gives no threshold for when concentration becomes a risk.
- **Decided:** Measured by share of the company's estimated workers, or of its sites when workers are known for less than 90% of open sites (DECISIONS #7):
  - **High:** 10% or more in one country or under one owner.
  - **Watch:** 5% or more.

  Both are shown on screen and can be changed by the user.
- **Why:**
  - At 10%, no owner is flagged for adidas or Nike, so Feng Tay's 9.3% of Nike's workers would be hidden.
  - At 3%, up to 10 owners are flagged, too many to act on.
  - Workers are used, where known, rather than site counts, because sites differ in size: Dong Nai has 5.4% of Nike's sites but 13.5% of its workers.
- **Would change our mind:** A threshold the company's risk team already uses.

## 9. The outcome description differs between the brief and FourKites' inventory

- **Unclear:** FourKites' outcome inventory also lists "historical performance trends by region" for this outcome. The brief's text does not.
- **Decided:** Follow the brief's text. Performance trends are not built.
- **Why:** We have no supplier performance data.
- **Would change our mind:** Performance data per supplier, such as delivery records.
