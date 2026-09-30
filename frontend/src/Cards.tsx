import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AlertChip, LevelChip } from "./Chips";
import type { Card as CardData } from "./summary";
import { countriesCard, disastersCard, ownersCard, type SummaryInput } from "./summary";

export type CardKind = "countries" | "owners" | "disasters";

function AnswerCard({ kind, title, card, pressed, onClick }: {
  kind: CardKind; title: string; card: CardData; pressed: boolean; onClick: () => void;
}) {
  return (
    <Card data-card={kind} sx={{ height: "100%", borderColor: pressed ? "primary.main" : "divider", borderWidth: pressed ? 2 : 1 }}>
      <CardActionArea onClick={onClick} aria-pressed={pressed} sx={{ height: "100%", alignItems: "stretch" }}>
        <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{title}</Typography>
          <Typography variant="h3" component="p">{card.headline}</Typography>
          {card.items.length > 0 && (
            <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
              {card.items.slice(0, 3).map((i) => (
                <Box component="li" key={i.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{i.label}</Typography>
                  {" "}<Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{i.value}</Typography>{" "}
                  {i.level?.startsWith("alert: ") ? <AlertChip alert={i.level.slice(7)} /> : <LevelChip level={i.level} />}
                </Box>
              ))}
            </Stack>
          )}
          {card.items.length > 3 && (
            <Typography variant="caption" color="text.secondary">
              Also: {card.items.slice(3).map((i) => `${i.label} ${i.value}${i.level && !i.level.startsWith("alert: ") ? ` (${i.level})` : ""}`).join(", ")}
            </Typography>
          )}
          {card.more && <Typography variant="caption" color="text.secondary">{card.more}</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ mt: "auto" }}>{card.note}</Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** The three answers a first-time user looks for. A click selects the matches and flies the map to them. */
export default function AnswerCards(props: {
  view: SummaryInput; high: number; watch: number; active: CardKind | null; onOpen: (k: CardKind) => void;
}) {
  const { view, high, watch, active, onOpen } = props;
  const cards: [CardKind, string, CardData][] = [
    ["countries", "Countries", countriesCard(view, high, watch)],
    ["owners", "Owner companies", ownersCard(view, watch)],
    ["disasters", "Disasters now", disastersCard(view)],
  ];
  return (
    <Grid container spacing={2} component="section" aria-label="Answers">
      {cards.map(([kind, title, card]) => (
        <Grid key={kind} size={{ xs: 12, md: 4 }}>
          <AnswerCard kind={kind} title={title} card={card} pressed={active === kind} onClick={() => onOpen(kind)} />
        </Grid>
      ))}
    </Grid>
  );
}
