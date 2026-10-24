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
      { name: "paper", light: "#FBFCFD", dark: "#0B111B", use: "Page background", swatch: "bg-paper" },
      { name: "paper-2", light: "#F1F4F8", dark: "#111926", use: "Cool grey bands, inset wells", swatch: "bg-paper-2" },
      { name: "card", light: "#FFFFFF", dark: "#151E2C", use: "Cards, dialogs, inputs", swatch: "bg-card" },
      { name: "line", light: "#E2E7EE", dark: "#233044", use: "Hairlines, dividers", swatch: "bg-line" },
      { name: "line-strong", light: "#C9D2DD", dark: "#33435A", use: "Control borders", swatch: "bg-line-strong" },
    ],
  },
  {
    title: "Ink",
    tokens: [
      { name: "ink", light: "#0E1726", dark: "#E9EEF5", use: "Headings, body · 17.5:1", swatch: "bg-ink" },
      { name: "ink-2", light: "#3D4A5C", dark: "#AEB9C8", use: "Secondary text · 8.8:1", swatch: "bg-ink-2" },
      { name: "ink-3", light: "#5A6779", dark: "#8D99AA", use: "Captions, placeholders · 5.6:1", swatch: "bg-ink-3" },
    ],
  },
  {
    title: "Brand",
    tokens: [
      { name: "teal", light: "#0B6B66", dark: "#5CC8BE", use: "Primary action, links · 6.2:1", swatch: "bg-teal" },
      { name: "teal-ink", light: "#08504C", dark: "#86DCD3", use: "Hover / pressed", swatch: "bg-teal-ink" },
      { name: "teal-soft", light: "#E3F2F0", dark: "#12302F", use: "Selected rows, tints", swatch: "bg-teal-soft" },
      { name: "sage", light: "#8CCFC2", dark: "#6FB5A8", use: "Mint: quiet emphasis, borders", swatch: "bg-sage" },
      { name: "sage-soft", light: "#E6F5F2", dark: "#142A27", use: "Calm panels", swatch: "bg-sage-soft" },
    ],
  },
  {
    title: "Accent (never text)",
    tokens: [
      { name: "terracotta", light: "#E5603F", dark: "#F0876B", use: "Coral: accent marks only · 3.4:1", swatch: "bg-terracotta" },
      { name: "terracotta-soft", light: "#FDE9E3", dark: "#3A211B", use: "Coral tint", swatch: "bg-terracotta-soft" },
      { name: "gold", light: "#F2B630", dark: "#F3C55A", use: "Sun: highlights, waypoint marks", swatch: "bg-gold" },
      { name: "gold-soft", light: "#FDF3DA", dark: "#33290F", use: "Safety banner, notes", swatch: "bg-gold-soft" },
    ],
  },
  {
    title: "Hues",
    tokens: [
      { name: "indigo", light: "#3B4FD8", dark: "#8C9BFF", use: "Email, papers · 6.2:1", swatch: "bg-indigo" },
      { name: "indigo-soft", light: "#E8EBFD", dark: "#1C2347", use: "Indigo tint · 5.4:1 text", swatch: "bg-indigo-soft" },
      { name: "violet", light: "#7A3FD6", dark: "#B79BFA", use: "Apply, trials · 5.8:1", swatch: "bg-violet" },
      { name: "violet-soft", light: "#F1E9FC", dark: "#2A1D45", use: "Violet tint · 5.1:1 text", swatch: "bg-violet-soft" },
      { name: "rose", light: "#B8326B", dark: "#F28AB5", use: "Call, financial aid · 5.5:1", swatch: "bg-rose" },
      { name: "rose-soft", light: "#FBE7EF", dark: "#3A1828", use: "Rose tint · 4.8:1 text", swatch: "bg-rose-soft" },
    ],
  },
  {
    title: "Contact channels",
    tokens: [
      { name: "ch-email", light: "#3B4FD8", dark: "#8C9BFF", use: "Email (alias of indigo)", swatch: "bg-ch-email" },
      { name: "ch-call", light: "#B8326B", dark: "#F28AB5", use: "Call (alias of rose)", swatch: "bg-ch-call" },
      { name: "ch-apply", light: "#7A3FD6", dark: "#B79BFA", use: "Apply (alias of violet)", swatch: "bg-ch-apply" },
    ],
  },
  {
    title: "Source types",
    tokens: [
      { name: "src-paper", light: "#3B4FD8", dark: "#8C9BFF", use: "Papers (indigo)", swatch: "bg-src-paper" },
      { name: "src-trial", light: "#7A3FD6", dark: "#B79BFA", use: "Trials (violet)", swatch: "bg-src-trial" },
      { name: "src-center", light: "#0B6B66", dark: "#5CC8BE", use: "Centers (teal)", swatch: "bg-src-center" },
      { name: "src-aid", light: "#B8326B", dark: "#F28AB5", use: "Financial aid (rose)", swatch: "bg-src-aid" },
    ],
  },
  {
    title: "Status",
    tokens: [
      { name: "ok", light: "#1E7A4C", dark: "#6FD39C", use: "Verified, sourced · 5.2:1", swatch: "bg-ok" },
      { name: "warn", light: "#B26A00", dark: "#F0B455", use: "Emerging: icons, borders · 4.1:1", swatch: "bg-warn" },
      { name: "warn-ink", light: "#8F5200", dark: "#F5C77A", use: "Warning text · 6.1:1", swatch: "bg-warn-ink" },
      { name: "danger", light: "#C0352B", dark: "#F28B82", use: "Errors, destructive · 5.4:1", swatch: "bg-danger" },
    ],
  },
];

export const TYPE_SCALE = [
  { token: "text-display", family: "Newsreader 300", sample: "Get seen, sooner.", display: true },
  { token: "text-h1", family: "Newsreader 300 · 32 to 44 px · once per page", sample: "Your case, in order.", display: true },
  { token: "text-h2", family: "Newsreader 400", sample: "Specialists who know this condition", display: true },
  { token: "text-h3", family: "Newsreader 400", sample: "Three trials are recruiting near you", display: true },
  { token: "text-h4", family: "Atkinson 700", sample: "What happens after you approve", display: false },
  { token: "text-lead", family: "Atkinson 400", sample: "We find, check and contact. You decide what is sent.", display: false },
  { token: "text-body", family: "Atkinson 400 · 16 px, 18 px in patient view", sample: "Every claim links to the page it came from, with the date we checked it.", display: false },
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
