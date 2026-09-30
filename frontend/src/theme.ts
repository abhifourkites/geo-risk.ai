import { createTheme } from "@mui/material/styles";

/** Risk colours, used only for meaning. Watch fills use #B26A00; Watch text and chips use #955800,
 *  because #B26A00 is 3.9:1 as text on the background (WCAG AA needs 4.5:1); #955800 is 5.3:1,
 *  and white on it 5.7:1. */
export const RISK = {
  high: "#B3261E",
  watchFill: "#B26A00",
  watchText: "#955800",
  disaster: "#5B4B8A",
  site: "#1F3A5F",
  selected: "#111111",
  land: "#E3E7E8",
  water: "#FFFFFF",
} as const;

export const theme = createTheme({
  palette: {
    background: { default: "#F6F7F5", paper: "#FFFFFF" },
    text: { primary: "#1F2A2E", secondary: "#5D6B70" },
    divider: "#D5DBDD",
    primary: { main: "#1F3A5F" },
    error: { main: RISK.high },
    warning: { main: RISK.watchText },
  },
  spacing: 8,
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize: 15,
    htmlFontSize: 16,
    body1: { fontSize: 15 },
    body2: { fontSize: 15 },
    caption: { fontSize: 13 },
    h1: { fontSize: 20, fontWeight: 600 },
    h2: { fontSize: 24, fontWeight: 600, lineHeight: 1.35 },
    h3: { fontSize: 18, fontWeight: 600, lineHeight: 1.35 },
    subtitle2: { fontSize: 14, fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiCard: { defaultProps: { variant: "outlined" } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, fontSize: 15 } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 } },
    MuiCssBaseline: {
      styleOverrides: {
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": { transitionDuration: "0s !important", animationDuration: "0s !important" },
        },
      },
    },
  },
});
