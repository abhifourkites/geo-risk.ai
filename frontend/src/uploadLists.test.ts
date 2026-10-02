import { describe, expect, it } from "vitest";
import { visibleLists } from "./uploadLists";

// List strings as in data/demo/facilities.csv (site counts from that file)
const lists = [
  { list: "A Brand / Retailer", sites: 1355 },
  { list: "Nike [Public List] (Nike Inc. Brand(s) August 2023 Facility List)", sites: 633 },
  { list: "Nike [Public List] (Nike Inc. Brand(s) February 2024 Facility List)", sites: 627 },
  { list: "adidas (OSHub-Data-Template-adidas-Primary-Jan 2026)", sites: 438 },
  { list: "Pou Chen Group (Claimed)", sites: 6 },
];
const hidden = new Set(["A Brand / Retailer", "Pou Chen Group (Claimed)"]);
const names = (o: Partial<Parameters<typeof visibleLists>[1]>) =>
  visibleLists(lists, { query: "", showAll: false, hidden, picked: new Set(), first: [], ...o }).map((l) => l.list);

describe("upload list table", () => {
  it("hides anonymous types and (Claimed) entries unless Show all lists is ticked", () => {
    expect(names({})).toEqual([lists[1].list, lists[2].list, lists[3].list]);
    expect(names({ showAll: true })).toEqual(lists.map((l) => l.list));
  });

  it("keeps a hidden list in view once it is ticked", () => {
    expect(names({ picked: new Set(["A Brand / Retailer"]) })).toContain("A Brand / Retailer");
  });

  it("searches any part of the list string, in any case", () => {
    expect(names({ query: "  FEBRUARY 2024 " })).toEqual([lists[2].list]);
    expect(names({ query: "claimed" })).toEqual([]);                         // hidden, and Show all lists not ticked
    expect(names({ query: "claimed", showAll: true })).toEqual([lists[4].list]);
  });

  it("shows the chosen company's lists first, then the rest in the file's order", () => {
    expect(names({ first: [lists[3].list] })).toEqual([lists[3].list, lists[1].list, lists[2].list]);
  });
});
