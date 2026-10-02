import { describe, expect, it } from "vitest";
import { eventName, parentName, shortEventName } from "./format";

// DR1018332's name as GDACS wrote it on 2 Oct 2026: 29 countries, double spaces, a trailing comma
const DROUGHT = "Drought in Austria, Bosnia  and  Herzegovina, Belgium, Belarus, Switzerland, Czech Republic, Germany, Denmark, Spain, "
  + "France, Croatia, Hungary, Ireland, Italy, Liechtenstein, Luxembourg, Moldova, Montenegro, Netherlands, Norway, Poland, Romania, "
  + "Serbia, Russia, Sweden, Slovenia, Slovakia, San Marino, Ukraine, ";

describe("event names", () => {
  it("tidies a GDACS name: single spaces, no trailing comma (the disaster's own panel)", () => {
    expect(eventName(DROUGHT)).toBe(DROUGHT.replace(/\s+/g, " ").replace(/, $/, ""));
    expect(eventName(DROUGHT).endsWith("San Marino, Ukraine")).toBe(true);
  });
  it("shows at most 3 countries elsewhere, then how many more", () => {
    expect(shortEventName(DROUGHT)).toBe("Drought in Austria, Bosnia and Herzegovina, Belgium and 26 more countries");
    expect(shortEventName("Flood in Türkiye")).toBe("Flood in Türkiye");
    expect(shortEventName("Drought in Spain, France, Italy, ")).toBe("Drought in Spain, France, Italy");
    expect(shortEventName("Tropical Cyclone FENGSHEN-25")).toBe("Tropical Cyclone FENGSHEN-25");
  });
});

describe("parent names", () => {
  const lei = "9845008E3DZ3B8366596";      // ACE TURTLE OMNI's parent: no name in our GLEIF files
  it("says what it knows", () => {
    expect(parentName({ parent_lei: lei, parent_name: "AUGUST PURPLE SERVICES PRIVATE LIMITED", name_status: "known" })).toBe("AUGUST PURPLE SERVICES PRIVATE LIMITED");
    expect(parentName({ parent_lei: lei, parent_name: null, name_status: "fetching" })).toBe(`fetching the name from GLEIF… (LEI ${lei})`);
    expect(parentName({ parent_lei: lei, parent_name: null, name_status: "not_available" })).toBe(`name not available (LEI ${lei})`);
  });
});
