import { Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";

/**
 * Warm Paper type pairing.
 * - Fraunces: a soft, editorial variable serif with an optical-size axis. Display and
 *   headings only. One italic word per headline is the signature move.
 * - Atkinson Hyperlegible Next: designed by the Braille Institute for low-vision
 *   readers. Everything people read or operate: body, labels, data, controls.
 *
 * `--font-text` keeps its old name so legacy CSS (app/styles/tokens.css) keeps working.
 */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
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
