import Chip from "@mui/material/Chip";
import { RISK } from "./theme";

/** High / Watch as a chip: always the word, never colour alone. */
export function LevelChip({ level }: { level: string | null }) {
  if (level !== "High" && level !== "Watch") return null;
  const bg = level === "High" ? RISK.high : RISK.watchText;
  return <Chip size="small" label={level} sx={{ bgcolor: bg, color: "#fff", height: 22 }} />;
}

/** A GDACS alert level (Green / Orange / Red) as a chip in the disaster colour. */
export function AlertChip({ alert }: { alert: string }) {
  return <Chip size="small" variant="outlined" label={`Alert: ${alert}`}
               sx={{ borderColor: RISK.disaster, color: RISK.disaster, height: 22 }} />;
}

/** The type of the item shown in the detail panel. */
export function TypeChip({ label }: { label: string }) {
  return <Chip size="small" variant="outlined" label={label} sx={{ height: 22 }} />;
}
