import { Atkinson_Hyperlegible_Next, Newsreader } from "next/font/google";

/**
 * Clear Day type pairing.
 * - Newsreader: a crisp, literary variable serif (weight axis only: the optical-size axis
 *   doubled the font payload and delayed the hero paint), cut for
 *   reading on screens. Display and headings only (h1-h3, hero lines).
 * - Atkinson Hyperlegible Next: designed by the Braille Institute for low-vision
 *   readers. Everything people read or operate: body, labels, data, controls.
 *
 * Newsreader loads in two calls that declare faces of the same "Newsreader" family:
 * the upright variable font (every weight) and a single static italic at 400, the only
 * italic the design uses (the `emph` word in headlines, the case label in the swarm).
 * The variable italic was 64 KB; the static 400 cut is 24 KB, and the hero needs it
 * for its first paint.
 *
 * The serif is exposed as `--font-serif`; app/styles/theme.css aliases the old
 * `--font-fraunces` name to it so existing utilities keep working.
 * `--font-text` keeps its old name so legacy CSS (app/styles/tokens.css) keeps working.
 */
const display = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  style: "normal",
});

const displayItalic = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif-italic",
  display: "swap",
  style: "italic",
  weight: "400",
});

const text = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-text",
  display: "swap",
  // next/font has no metric overrides for this family yet; fall back explicitly.
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const fontVariables = `${display.variable} ${displayItalic.variable} ${text.variable}`;
