import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { DataGrid, QuickFilter, QuickFilterControl, Toolbar, type GridColDef, type GridComparatorFn } from "@mui/x-data-grid";
import { useState } from "react";
import type { CountryShare, OwnerShare, View } from "./api";
import { LevelChip } from "./Chips";
import { countryName, pct, plural } from "./format";
import { basisWords } from "./summary";

const LEVEL_RANK: Record<string, number> = { High: 2, Watch: 1 };
const byLevel: GridComparatorFn<string | null> = (a, b) => (LEVEL_RANK[a ?? ""] ?? 0) - (LEVEL_RANK[b ?? ""] ?? 0);
function shareCol<R extends { share: number }>(): GridColDef<R> {
  return { field: "share", headerName: "Share", type: "number", width: 100, valueFormatter: (v: number) => pct(v) };
}
function levelCol<R extends { level: string | null }>(): GridColDef<R> {
  return { field: "level", headerName: "Level", width: 100, sortComparator: byLevel, renderCell: (p) => <LevelChip level={p.value ?? null} /> };
}

type CountryRow = CountryShare & { id: string; name: string };
type OwnerRow = OwnerShare & { id: string; countriesText: string };

const countryCols: GridColDef<CountryRow>[] = [
  { field: "name", headerName: "Country", flex: 1, minWidth: 160 },
  shareCol<CountryRow>(), levelCol<CountryRow>(),
  { field: "sites", headerName: "Sites", type: "number", width: 90 },
  { field: "workers_known", headerName: "Workers known", type: "number", width: 140,
    valueFormatter: (_v, row) => `${row.workers_known} of ${row.sites}` },
];
const ownerCols: GridColDef<OwnerRow>[] = [
  { field: "owner", headerName: "Owner", flex: 1, minWidth: 220 },
  shareCol<OwnerRow>(), levelCol<OwnerRow>(),
  { field: "sites", headerName: "Sites", type: "number", width: 90 },
  { field: "countriesText", headerName: "Countries", width: 160,
    sortComparator: (_a, _b, p1, p2) => Number(p1.api.getRow(p1.id).countries) - Number(p2.api.getRow(p2.id).countries) },
];

/** Only a search box, open from the start. */
function SearchToolbar() {
  return (
    <Toolbar>
      <QuickFilter defaultExpanded>
        <QuickFilterControl size="small" placeholder="Search" aria-label="Search this table" />
      </QuickFilter>
    </Toolbar>
  );
}

const grid = {
  autoHeight: true, density: "compact", showToolbar: true, disableRowSelectionOnClick: true, disableVirtualization: true,
  disableColumnSelector: true, disableDensitySelector: true, pageSizeOptions: [10, 25, 50, 100],
  initialState: { pagination: { paginationModel: { pageSize: 10, page: 0 } }, sorting: { sortModel: [{ field: "share", sort: "desc" as const }] } },
  slots: { toolbar: SearchToolbar }, disableColumnFilter: true,
  sx: { border: 0, "& .MuiDataGrid-row": { cursor: "pointer" } },
} as const;

/** One card with two tabs, each a sortable, searchable grid. A row click (or Enter) opens it in the panel. */
export default function DataTables({ view, onCountry, onOwner }: { view: View; onCountry: (code: string) => void; onOwner: (o: string) => void }) {
  const [tab, setTab] = useState(0);
  const countries: CountryRow[] = view.countries.map((c) => ({ ...c, id: c.country_code ?? "unknown", name: countryName(c.country_code) }));
  const owners: OwnerRow[] = view.owners.all.map((o) => ({
    ...o, id: o.owner, countriesText: o.countries === 1 ? countryName(o.country) : plural(o.countries, "country", "countries"),
  }));
  const openCountry = (r: CountryRow) => { if (r.country_code) onCountry(r.country_code); };
  return (
    <Card>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Tables" sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Countries" id="tab-countries" aria-controls="panel-countries" />
        <Tab label="Owner companies" id="tab-owners" aria-controls="panel-owners" />
      </Tabs>
      <Box sx={{ px: 2, pt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Share of {basisWords(view)}, largest first. {tab === 1 && "A site with 2 or more owners counts in full under each. "}Click a row to see it on the map.
        </Typography>
      </Box>
      <Box role="tabpanel" id="panel-countries" aria-labelledby="tab-countries" hidden={tab !== 0} sx={{ px: 1, pb: 1 }}>
        {tab === 0 && <DataGrid {...grid} rows={countries} columns={countryCols} label="Countries"
                                onRowClick={(p) => openCountry(p.row)} onCellKeyDown={(p, e) => { if (e.key === "Enter") openCountry(p.row); }} />}
      </Box>
      <Box role="tabpanel" id="panel-owners" aria-labelledby="tab-owners" hidden={tab !== 1} sx={{ px: 1, pb: 1 }}>
        {tab === 1 && <DataGrid {...grid} rows={owners} columns={ownerCols} label="Owner companies"
                                onRowClick={(p) => onOwner(p.row.owner)} onCellKeyDown={(p, e) => { if (e.key === "Enter") onOwner(p.row.owner); }} />}
      </Box>
    </Card>
  );
}
