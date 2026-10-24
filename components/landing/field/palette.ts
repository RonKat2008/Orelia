import { SOURCE_TYPES } from "./geometry";

export type Rgb = [number, number, number];

export interface FieldPalette {
  /** Colours for paper, trial, center, aid (SOURCE_TYPES order). */
  sources: [Rgb, Rgb, Rgb, Rgb];
  glow: Rgb;
  ring: Rgb;
  isDark: boolean;
  /** Overall particle opacity: lower on white so text over the field stays AA-legible. */
  particleOpacity: number;
  haloOpacity: number;
}

const FALLBACK: Rgb = [0.3, 0.4, 0.5];

/** Parses #rgb / #rrggbb (the token format); anything else falls back to a neutral slate. */
export function hexToRgb(hex: string): Rgb {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  if (!/^[0-9a-f]{6}/i.test(full)) return FALLBACK;
  const value = Number.parseInt(full.slice(0, 6), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Reads the Clear Day tokens so the field follows the active theme. */
export function readPalette(element: Element): FieldPalette {
  const styles = getComputedStyle(element);
  const isDark = styles.colorScheme.includes("dark");
  const token = (name: string) => hexToRgb(styles.getPropertyValue(name));
  const [paper, trial, center, aid] = SOURCE_TYPES.map((type) => token(`--src-${type}`));
  return {
    sources: [paper, trial, center, aid],
    glow: token("--gold"),
    ring: token("--teal"),
    isDark,
    particleOpacity: isDark ? 0.85 : 0.9,
    haloOpacity: isDark ? 0.34 : 0.5,
  };
}
