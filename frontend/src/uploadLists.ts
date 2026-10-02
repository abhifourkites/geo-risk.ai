/** Which rows the upload page's list table shows, and in what order; and what picking a company fills in. */
import type { Contributor } from "./api";

export interface ListRow { list: string; sites: number }

/** Picking a company ticks only its current lists, marks them current, and fills in its name. Its other lists
 *  stay unticked (they are shown first, so they can be ticked by hand). */
export function prefill(c: Contributor | null): { picked: Set<string>; current: Set<string>; name: string } {
  return { picked: new Set(c?.current_lists ?? []), current: new Set(c?.current_lists ?? []), name: c?.name ?? "" };
}

/** The chosen company's lists first, then the rest as the file has them (most sites first). Anonymous types and
 *  "(Claimed)" entries (`hidden`) are left out unless `showAll` is ticked or the list is ticked; `query` matches
 *  any part of the list string, in any case. */
export function visibleLists(lists: ListRow[], o: { query: string; showAll: boolean; hidden: Set<string>; picked: Set<string>; first: string[] }): ListRow[] {
  const q = o.query.trim().toLowerCase();
  const rank = new Map(o.first.map((l, i) => [l, i]));
  return lists
    .map((l, i) => ({ l, i, r: rank.get(l.list) ?? lists.length }))
    .filter(({ l }) => (o.showAll || o.picked.has(l.list) || !o.hidden.has(l.list)) && (!q || l.list.toLowerCase().includes(q)))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ l }) => l);
}
