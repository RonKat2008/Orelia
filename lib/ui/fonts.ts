import { Atkinson_Hyperlegible_Next, Newsreader } from "next/font/google";

/**
 * Clear Day type pairing.
 * - Newsreader: a crisp, literary variable serif (weight axis only: the optical-size axis
 *   doubled the font payload and delayed the hero paint), cut for
 *   reading on screens. Display and headings only (h1-h3, hero lines).
 * - Atkinson Hyperlegible Next: designed by the Braille Institute for low-vision
 *   readers. Everything people read or operate: body, labels, data, controls.
 *
 * The serif is exposed as `--font-serif`; app/styles/theme.css aliases the old
 * `--font-fraunces` name to it so existing utilities keep working.
 * `--font-text` keeps its old name so legacy CSS (app/styles/tokens.css) keeps working.
 */
const display = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
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
