import { Atkinson_Hyperlegible_Next, Newsreader } from "next/font/google";

/**
 * Type pairing.
 * - Newsreader: an editorial text serif with optical sizes; used for headings and
 *   resource names so results read like a considered briefing, not a dashboard.
 * - Atkinson Hyperlegible Next: designed by the Braille Institute for low-vision
 *   readers; used for body, labels and data. Many users are tired, ill or on
 *   medication; legibility is the point.
 *
 * Exposes CSS variables consumed by app/styles/tokens.css. Phase B: apply
 * `fontVariables` to <html> in app/layout.tsx.
 */
const display = Newsreader({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
});

const text = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-text",
  display: "swap",
  // next/font has no metric overrides for this family yet; fall back explicitly.
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const fontVariables = `${display.variable} ${text.variable}`;
