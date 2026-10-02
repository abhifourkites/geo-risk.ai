import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { CountryShare, HazardDetail, OwnerDetail, OwnerShare, SiteDetail, View } from "./api";
import type { CardKind } from "./Cards";
import { AlertChip, LevelChip, TypeChip } from "./Chips";
import { CERTIFICATE_WARNINGS, countryName, eventName, parentName, pct, plural, shortEventName, threshold, WARNINGS } from "./format";
import { basisWords, disasterEvents } from "./summary";

export type Detail =
  | { kind: "site"; data: SiteDetail }
  | { kind: "owner"; data: OwnerDetail }
  | { kind: "disaster"; data: HazardDetail }
  | { kind: "country"; code: string }
  | { kind: "card"; card: CardKind }
  | null;

export interface Go { site: (os: string) => void; owner: (o: string) => void; disaster: (e: string) => void; country: (c: string) => void }
const PARENT_TYPE: Record<string, string> = { direct: "Direct parent", top: "Top parent", branch: "Branch of" };
/** Why a site inside an event's area is not counted (GDACS's affectedcountries list). */
export const notListed = (code: string | null) =>
  code ? `inside the area, but GDACS does not list ${countryName(code)} as affected` : "inside the area, but the site's country is not known";

function Header({ type, name, children }: { type: string; name: string; children?: ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <TypeChip label={type} />
      <Typography variant="h3" component="h2" sx={{ mt: 1, overflowWrap: "anywhere" }}>{name}</Typography>
      {children}
    </Box>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mt: 2 }}>
      <Typography variant="subtitle2" component="h3">{title}</Typography>
      {children}
    </Box>
  );
}
/** A clickable row: it selects that item (keyboard: Tab and Enter). */
function Pick({ onClick, primary, secondary, end }: { onClick: () => void; primary: ReactNode; secondary?: ReactNode; end?: ReactNode }) {
  return (
    <ListItem disablePadding>
      <ListItemButton onClick={onClick} sx={{ py: 0.25, px: 1, borderRadius: 1 }}>
        <ListItemText primary={primary} secondary={secondary} slotProps={{ primary: { variant: "body2" }, secondary: { variant: "caption" } }} />
        {end}
      </ListItemButton>
    </ListItem>
  );
}
const Plain = ({ children }: { children: ReactNode }) =>
  <ListItem sx={{ py: 0.25, px: 1 }}><ListItemText primary={children} slotProps={{ primary: { variant: "body2" } }} /></ListItem>;

function SitePanel({ d, go }: { d: SiteDetail; go: Go }) {
  const s = d.site;
  return (
    <>
      <Header type="Site" name={s.name}>
        <Typography variant="body2" color="text.secondary">{countryName(s.country_code)}</Typography>
      </Header>
      <Section title="Owner companies">
        {d.owners.length === 0 ? <Typography variant="body2">Not reported.</Typography>
          : <List dense disablePadding>{d.owners.map((o) => <Pick key={o} onClick={() => go.owner(o)} primary={o} />)}</List>}
      </Section>
      <Section title="Warnings">
        {s.warnings.length === 0 ? <Typography variant="body2">None.</Typography>
          : <List dense disablePadding>{s.warnings.map((w) => <Plain key={w}>{WARNINGS[w] ?? w}</Plain>)}</List>}
        {s.warnings.some((w) => CERTIFICATE_WARNINGS.has(w)) &&
          <Typography variant="caption" color="text.secondary">Certificate dates are checked against the day the list was loaded.</Typography>}
      </Section>
      <Section title="Disaster area">
        {d.hazard_status !== "ok" ? <Typography variant="body2">{d.hazard_status === "loading" ? "Checking for current disasters…" : "Disaster data unavailable."}</Typography>
          : d.hazards.length === 0 && d.hazards_unlisted.length === 0 ? <Typography variant="body2">Not inside a current disaster area.</Typography>
          : <List dense disablePadding>
              {d.hazards.map((h) => (
                <Pick key={h.event_id} onClick={() => go.disaster(h.event_id)} primary={shortEventName(h.event_name)}
                      secondary={h.level ? `${h.level} for your sites` : undefined} end={<AlertChip alert={h.alert_level} />} />
              ))}
              {d.hazards_unlisted.map((h) => (
                <Pick key={`unlisted:${h.event_id}`} onClick={() => go.disaster(h.event_id)} primary={shortEventName(h.event_name)}
                      secondary={`Not counted: ${notListed(h.country_code)}.`} />
              ))}
            </List>}
      </Section>
      <Section title="On your lists">
        <List dense disablePadding>{s.list_names.split(" | ").map((l) => <Plain key={l}>{l}</Plain>)}</List>
      </Section>
      <Section title="Parent company">
        {d.gleif.confirmed.length === 0 ? <Typography variant="body2">No confirmed parent company.</Typography> : d.gleif.confirmed.map((m) => (
          m.parents.length === 0
            ? <Typography key={m.lei} variant="body2">Confirmed company (LEI {m.lei}); no parent company recorded in GLEIF.</Typography>
            : <List key={m.lei} dense disablePadding>{m.parents.map((p) => <Plain key={p.type}>{PARENT_TYPE[p.type] ?? p.type}: {parentName(p)}</Plain>)}</List>
        ))}
      </Section>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
        Open Supply Hub ID {s.os_id}{s.workers_est != null ? ` · about ${s.workers_est} workers` : " · workers not reported"}
      </Typography>
    </>
  );
}

function OwnerPanel({ d, share, view, go }: { d: OwnerDetail; share: OwnerShare | undefined; view: View; go: Go }) {
  return (
    <>
      <Header type="Owner" name={d.owner}>
        {share && <Stack sx={{ alignItems: "center" }} direction="row" spacing={1}><Typography variant="body2">{pct(share.share)} of {basisWords(view)}</Typography><LevelChip level={share.level} /></Stack>}
      </Header>
      <Typography variant="body2">
        {plural(d.sites.length, "site", "sites")} in {plural(d.countries.length, "country", "countries")}: {d.countries.map(countryName).join(", ")}.
        {" "}{d.sites.length < 2 ? "" : d.all_in_one_country ? "All in one country." : "Not all in one country."}
      </Typography>
      <Typography variant="caption" color="text.secondary">These sites are highlighted on the map.</Typography>
      <Section title="Its sites">
        <List dense disablePadding>{d.sites.map((s) => <Pick key={s.os_id} onClick={() => go.site(s.os_id)} primary={s.name} secondary={countryName(s.country_code)} />)}</List>
      </Section>
    </>
  );
}

function DisasterPanel({ d, go }: { d: HazardDetail; go: Go }) {
  const e = d.event;
  const others = Object.entries(d.owners_other_sites);
  const owners = [...new Set(d.sites.flatMap((s) => s.owners))];
  const byCountry = new Map<string, HazardDetail["unlisted"]>();
  for (const s of d.unlisted) byCountry.set(s.country_code ?? "", [...(byCountry.get(s.country_code ?? "") ?? []), s]);
  const unlisted = [...byCountry].sort(([a], [b]) => countryName(a || null).localeCompare(countryName(b || null)));
  return (
    <>
      <Header type="Disaster" name={eventName(e.name)}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
          <AlertChip alert={e.alert_level} />
          {e.level && <><Typography variant="body2">so your sites inside are at</Typography><LevelChip level={e.level} /></>}
        </Stack>
      </Header>
      <Typography variant="caption" color="text.secondary">GDACS alerts are automatic, not reviewed by people. Confirm before acting.</Typography>
      {d.sites.length === 0 ? <Typography variant="body2" sx={{ mt: 2 }}>{d.unlisted.length ? "None of your sites is counted inside this disaster." : "None of your sites are inside this area."}</Typography> : (
        <>
          <Section title={`Your sites inside (${d.sites.length})`}>
            <List dense disablePadding>{d.sites.map((s) => (
              <Pick key={s.os_id} onClick={() => go.site(s.os_id)} primary={s.name}
                    secondary={`${countryName(s.country_code)}${s.owners.length ? ` · ${s.owners.length === 1 ? "Owner" : "Owners"}: ${s.owners.join(", ")}` : ""}`} />
            ))}</List>
          </Section>
          <Section title="Their owners">
            {owners.length === 0 ? <Typography variant="body2">Not reported.</Typography>
              : <List dense disablePadding>{owners.map((o) => <Pick key={o} onClick={() => go.owner(o)} primary={o} />)}</List>}
          </Section>
          <Section title="Those owners' other sites">
            {others.length === 0 ? <Typography variant="body2">None.</Typography> : others.map(([owner, sites]) => (
              <Box key={owner} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">{owner}: {plural(sites.length, "other site", "other sites")}</Typography>
                <List dense disablePadding>{sites.map((s) => <Pick key={s.os_id} onClick={() => go.site(s.os_id)} primary={s.name} secondary={countryName(s.country_code)} />)}</List>
              </Box>
            ))}
          </Section>
        </>
      )}
      {unlisted.map(([code, sites]) => (
        <Section key={code} title={`${notListed(code || null)[0].toUpperCase()}${notListed(code || null).slice(1)} (${sites.length})`}>
          <Typography variant="caption" color="text.secondary" component="p">
            Not counted: GDACS lists {plural(e.affected_countries.length, "country", "countries")} as affected by this event.
          </Typography>
          <List dense disablePadding>{sites.map((s) => <Pick key={s.os_id} onClick={() => go.site(s.os_id)} primary={s.name} secondary={countryName(s.country_code)} />)}</List>
        </Section>
      ))}
    </>
  );
}

function CountryPanel({ c, code, view, go }: { c: CountryShare | undefined; code: string; view: View; go: Go }) {
  const sites = view.sites.filter((s) => s.country_code === code).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <Header type="Country" name={countryName(code)}>
        {c && <Stack sx={{ alignItems: "center" }} direction="row" spacing={1}><Typography variant="body2">{pct(c.share)} of {basisWords(view)}</Typography><LevelChip level={c.level} /></Stack>}
      </Header>
      {!c ? <Typography variant="body2">None of your sites are in this country.</Typography> : (
        <>
          <Typography variant="body2">{plural(c.sites, "site", "sites")}; workers known for {c.workers_known} of {c.sites}.</Typography>
          <Typography variant="caption" color="text.secondary">These sites are highlighted on the map.</Typography>
          <Section title="Sites">
            <List dense disablePadding>{sites.map((s) => <Pick key={s.os_id} onClick={() => go.site(s.os_id)} primary={s.name} />)}</List>
          </Section>
        </>
      )}
    </>
  );
}

function CardPanel({ card, view, high, watch, go }: { card: CardKind; view: View; high: number; watch: number; go: Go }) {
  if (card === "countries") {
    const flagged = view.countries.filter((c) => c.level);
    return (
      <>
        <Header type="Countries" name="Where you are most exposed" />
        <Typography variant="caption" color="text.secondary">High: {threshold(high)} or more of {basisWords(view)}. Watch: {threshold(watch)} or more. Outlined on the map.</Typography>
        {flagged.length === 0 ? <Typography variant="body2" sx={{ mt: 1 }}>No country holds {threshold(watch)} or more.</Typography> : (
          <List dense disablePadding sx={{ mt: 1 }}>{flagged.map((c) => (
            <Pick key={c.country_code} onClick={() => go.country(c.country_code!)} primary={countryName(c.country_code)} secondary={pct(c.share)} end={<LevelChip level={c.level} />} />
          ))}</List>
        )}
      </>
    );
  }
  if (card === "owners") {
    const flagged = view.owners.all.filter((o) => o.level);
    return (
      <>
        <Header type="Owner companies" name="Owners holding the biggest shares" />
        <Typography variant="caption" color="text.secondary">Their sites are highlighted on the map.</Typography>
        {flagged.length === 0 && <Typography variant="body2" sx={{ mt: 1 }}>No owner holds {threshold(watch)} or more. The largest is shown below.</Typography>}
        <List dense disablePadding sx={{ mt: 1 }}>{(flagged.length ? flagged : view.owners.all.slice(0, 1)).map((o) => (
          <Pick key={o.owner} onClick={() => go.owner(o.owner)} primary={o.owner} secondary={`${pct(o.share)} · ${plural(o.sites, "site", "sites")}`} end={<LevelChip level={o.level} />} />
        ))}</List>
      </>
    );
  }
  const st = view.hazards.status.state;
  const events = disasterEvents(view.hazards.sites);
  return (
    <>
      <Header type="Disasters now" name="Your sites inside a current disaster area" />
      {st !== "ok" ? <Typography variant="body2">{st === "loading" ? "Checking for current disasters…" : "Disaster data unavailable."}</Typography>
        : events.length === 0 ? <Typography variant="body2">None of your sites is inside a current disaster area.</Typography>
        : <List dense disablePadding>{events.map((e) => (
            <Pick key={e.event_id} onClick={() => go.disaster(e.event_id)} primary={shortEventName(e.name)}
                  secondary={`${plural(e.sites.size, "site", "sites")}${e.level ? ` · ${e.level} for your sites` : ""}`} end={<AlertChip alert={e.alert_level} />} />
          ))}</List>}
    </>
  );
}

export default function DetailPanel(props: { detail: Detail; view: View; high: number; watch: number; go: Go }) {
  const { detail, view, go } = props;
  return (
    <Card component="aside" aria-label="Details" aria-live="polite" sx={{ height: { md: 560 }, display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ overflow: "auto", flex: 1 }}>
        {!detail && <Typography variant="body2" color="text.secondary">Click a site, a country or a disaster area to see details.</Typography>}
        {detail?.kind === "site" && <SitePanel d={detail.data} go={go} />}
        {detail?.kind === "owner" && <OwnerPanel d={detail.data} share={view.owners.all.find((o) => o.owner === detail.data.owner)} view={view} go={go} />}
        {detail?.kind === "disaster" && <DisasterPanel d={detail.data} go={go} />}
        {detail?.kind === "country" && <CountryPanel c={view.countries.find((c) => c.country_code === detail.code)} code={detail.code} view={view} go={go} />}
        {detail?.kind === "card" && <CardPanel card={detail.card} view={view} high={props.high} watch={props.watch} go={go} />}
      </CardContent>
    </Card>
  );
}
