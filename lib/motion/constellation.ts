/** Pure geometry for the radial swarm constellation. Unit-tested; no DOM. */

export interface Point {
  x: number;
  y: number;
}

export interface ConstellationOptions {
  cx: number;
  cy: number;
  radius: number;
  /** Degrees; -90 puts the first node at 12 o'clock. */
  startAngle?: number;
}

export const CONSTELLATION_VIEWBOX = { width: 440, height: 440 } as const;
export const CONSTELLATION_CENTER: Point = { x: 220, y: 220 };
export const CONSTELLATION_RADIUS = 160;

const round = (n: number) => Math.round(n * 100) / 100;

export function layoutConstellation(count: number, options: ConstellationOptions): Point[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  const start = ((options.startAngle ?? -90) * Math.PI) / 180;
  const step = count === 0 ? 0 : (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: round(options.cx + options.radius * Math.cos(start + i * step)),
    y: round(options.cy + options.radius * Math.sin(start + i * step)),
  }));
}

/**
 * A gently bowed route from `from` to `to`, like a road on a map rather than a
 * ruler line. `bend` is the control-point offset as a fraction of the length.
 */
export function routePath(from: Point, to: Point, bend = 0.12): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular offset, always bowing clockwise so the figure reads as a spiral.
  const cx = round(mx - dy * bend);
  const cy = round(my + dx * bend);
  return `M ${round(from.x)} ${round(from.y)} Q ${cx} ${cy} ${round(to.x)} ${round(to.y)}`;
}

/** A winding horizontal route through evenly spaced waypoints (shortlist header). */
export function waypointRoute(count: number, width: number, height: number): { d: string; points: Point[] } {
  if (count < 1) return { d: "", points: [] };
  const padding = 24;
  const usable = width - padding * 2;
  const mid = height / 2;
  const amplitude = height * 0.22;
  const points = Array.from({ length: count }, (_, i) => ({
    x: round(count === 1 ? width / 2 : padding + (usable * i) / (count - 1)),
    y: round(mid + (i % 2 === 0 ? -amplitude : amplitude) * 0.5),
  }));
  const segments = points.slice(1).map((p, i) => {
    const prev = points[i];
    const c1x = round(prev.x + (p.x - prev.x) / 2);
    return `C ${c1x} ${prev.y} ${c1x} ${p.y} ${p.x} ${p.y}`;
  });
  return { d: [`M ${points[0].x} ${points[0].y}`, ...segments].join(" "), points };
}
