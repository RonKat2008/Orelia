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

/** Pushes a colour away from its own luminance (more saturated), clamped to 0..1. */
export function saturate([r, g, b]: Rgb, amount: number): Rgb {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const push = (c: number) => Math.min(1, Math.max(0, luma + (c - luma) * amount));
  return [push(r), push(g), push(b)];
}

/** Source hues are tuned for text; on tiny dots they need extra saturation to stay distinct. */
const SOURCE_SATURATION = { light: 1.3, dark: 1.15 };

/** Reads the Clear Day tokens so the field follows the active theme. */
export function readPalette(element: Element): FieldPalette {
  const styles = getComputedStyle(element);
  const isDark = styles.colorScheme.includes("dark");
  const token = (name: string) => hexToRgb(styles.getPropertyValue(name));
  const boost = isDark ? SOURCE_SATURATION.dark : SOURCE_SATURATION.light;
  const [paper, trial, center, aid] = SOURCE_TYPES.map((type) => saturate(token(`--src-${type}`), boost));
  return {
    sources: [paper, trial, center, aid],
    glow: token("--gold"),
    ring: token("--teal"),
    isDark,
    particleOpacity: isDark ? 0.9 : 1,
    haloOpacity: isDark ? 0.4 : 0.62,
  };
}
