export interface ColorToken {
  name: string;
  light: string;
  dark: string;
  use: string;
  /** Tailwind class for the swatch fill. */
  swatch: string;
}

export interface ColorGroup {
  title: string;
  tokens: ColorToken[];
}

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Surfaces",
    tokens: [
      { name: "paper", light: "#FAF6EF", dark: "#141A19", use: "Page background", swatch: "bg-paper" },
      { name: "paper-2", light: "#F3EDE2", dark: "#1A2120", use: "Alt bands, inset wells", swatch: "bg-paper-2" },
      { name: "card", light: "#FFFDF9", dark: "#1E2725", use: "Cards, dialogs, inputs", swatch: "bg-card" },
      { name: "line", light: "#E6DED0", dark: "#2C3634", use: "Hairlines, dividers", swatch: "bg-line" },
      { name: "line-strong", light: "#D3C8B5", dark: "#3D4A47", use: "Control borders", swatch: "bg-line-strong" },
    ],
  },
  {
    title: "Ink",
    tokens: [
      { name: "ink", light: "#1F2A2A", dark: "#EFE8DC", use: "Headings, body · 13.7:1", swatch: "bg-ink" },
      { name: "ink-2", light: "#4A5654", dark: "#B8B0A3", use: "Secondary text · 7.1:1", swatch: "bg-ink-2" },
      { name: "ink-3", light: "#5F6866", dark: "#9A9387", use: "Captions, placeholders · 5.2:1", swatch: "bg-ink-3" },
    ],
  },
  {
    title: "Brand",
    tokens: [
      { name: "teal", light: "#1F5E5B", dark: "#7CC1B9", use: "Primary action, links · 6.9:1", swatch: "bg-teal" },
      { name: "teal-ink", light: "#164745", dark: "#9FD4CD", use: "Hover / pressed", swatch: "bg-teal-ink" },
      { name: "teal-soft", light: "#E1EBE8", dark: "#1D2F2D", use: "Selected rows, tints", swatch: "bg-teal-soft" },
      { name: "sage", light: "#A8C3B0", dark: "#7FA08A", use: "Quiet emphasis, borders", swatch: "bg-sage" },
      { name: "sage-soft", light: "#E3ECE5", dark: "#1F2B25", use: "Calm panels", swatch: "bg-sage-soft" },
    ],
  },
  {
    title: "Accent",
    tokens: [
      { name: "terracotta", light: "#D9805F", dark: "#E8917A", use: "Accent marks only, never text", swatch: "bg-terracotta" },
      { name: "gold", light: "#E8C98A", dark: "#E0BF7E", use: "Highlights, waypoint marks", swatch: "bg-gold" },
      { name: "gold-soft", light: "#F6ECD6", dark: "#2C261A", use: "Safety banner, notes", swatch: "bg-gold-soft" },
    ],
  },
  {
    title: "Status",
    tokens: [
      { name: "ok", light: "#2F6B4F", dark: "#86C7A2", use: "Verified, done · 5.8:1", swatch: "bg-ok" },
      { name: "warn", light: "#A86B12", dark: "#E0AE5A", use: "Warning icons and borders", swatch: "bg-warn" },
      { name: "warn-ink", light: "#8A560B", dark: "#E9BF75", use: "Warning text · 5.7:1", swatch: "bg-warn-ink" },
      { name: "danger", light: "#B4432F", dark: "#E8917A", use: "Errors, destructive · 5.2:1", swatch: "bg-danger" },
    ],
  },
];

export const TYPE_SCALE = [
  { token: "text-display", family: "Fraunces 300", sample: "Get *seen*, sooner.", display: true },
  { token: "text-h1", family: "Fraunces 300", sample: "Your case, *in order*.", display: true },
  { token: "text-h2", family: "Fraunces 400", sample: "Specialists who *know* this condition", display: true },
  { token: "text-h3", family: "Fraunces 400", sample: "Three trials are recruiting near you", display: true },
  { token: "text-h4", family: "Atkinson 700", sample: "What happens after you approve", display: false },
  { token: "text-lead", family: "Atkinson 400", sample: "We find, check and contact. You decide what is sent.", display: false },
  { token: "text-body", family: "Atkinson 400", sample: "Every claim links to the page it came from, with the date we checked it.", display: false },
  { token: "text-small", family: "Atkinson 400", sample: "Last checked 2 hours ago by the Trials agent.", display: false },
  { token: "text-micro", family: "Atkinson 700 caps", sample: "Evidence", display: false },
  { token: "text-mono", family: "System mono", sample: "case_7f3a · NCT05123456", display: false },
] as const;

export const SPACE = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const;

export const RADII = [
  { token: "rounded-sm", value: "6px", use: "Controls, chips in tables" },
  { token: "rounded-md", value: "12px", use: "Inputs, buttons, menus" },
  { token: "rounded-lg", value: "20px", use: "Cards, dialogs, sheets" },
  { token: "rounded-pill", value: "999px", use: "Badges, source chips, toggles" },
] as const;

export const SHADOWS = [
  { token: "shadow-xs", use: "Resting controls" },
  { token: "shadow-sm", use: "Buttons, chips on hover" },
  { token: "shadow-md", use: "Raised cards" },
  { token: "shadow-lg", use: "Menus, popovers, hovered cards" },
  { token: "shadow-xl", use: "Dialogs, sheets" },
  { token: "shadow-inset", use: "Wells, tracks, pressed" },
] as const;

export const DURATIONS = [
  { token: "duration-150", ms: 150, use: "Hover, focus, colour" },
  { token: "duration-300", ms: 300, use: "Toggles, tabs, small moves" },
  { token: "duration-500", ms: 500, use: "Panels arriving, reveals" },
  { token: "duration-700", ms: 700, use: "Progress, page-level moves" },
] as const;

export const JOURNEY = [
  { id: "tell", label: "Tell us", description: "Condition and goals" },
  { id: "search", label: "We search", description: "Agents gather options" },
  { id: "review", label: "You review", description: "Every claim sourced" },
  { id: "approve", label: "You approve", description: "Nothing sent without you" },
  { id: "seen", label: "Get seen", description: "Replies, next steps" },
];
