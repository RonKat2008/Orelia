/**
 * Pure geometry for the hero "wayfinding field": many fine paths that drift in from
 * beyond the edges and converge on one lit point. The WebGL shader (FieldCanvas) and
 * the static SVG poster (FieldPoster) share this math, so the poster is a true still
 * frame of the live field. Field space: x in [-aspect, aspect], y in [-1, 1], y up.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PathSeed {
  /** Direction the path arrives from, radians. */
  angle: number;
  /** Start distance from the target, in field units (beyond the edge for most). */
  reach: number;
  /** Signed curvature: perpendicular offset of the control point, as a share of distance. */
  bend: number;
  /** 0..1 start offset in the travel cycle. */
  phase: number;
  /** Travel cycles per second. */
  speed: number;
}

/** Normalised (0..1, top-left origin) position of the lit point, by layout. */
export interface FieldLayout {
  targetX: number;
  targetY: number;
}

export const DESKTOP_LAYOUT: FieldLayout = { targetX: 0.535, targetY: 0.36 };
export const MOBILE_LAYOUT: FieldLayout = { targetX: 0.84, targetY: 0.1 };
export const WIDE_BREAKPOINT_PX = 1024;

export const WOBBLE_AMPLITUDE = 0.045;
export const WOBBLE_FREQUENCY = 2.0;

/** Deterministic PRNG (mulberry32) so the server poster and tests are reproducible. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutForWidth(widthPx: number): FieldLayout {
  return widthPx >= WIDE_BREAKPOINT_PX ? DESKTOP_LAYOUT : MOBILE_LAYOUT;
}

/** Converts the normalised layout target into field space for a given aspect ratio. */
export function targetInField(layout: FieldLayout, aspect: number): Point {
  return { x: (layout.targetX * 2 - 1) * aspect, y: 1 - layout.targetY * 2 };
}

export function makePathSeeds(count: number, seed = 7): PathSeed[] {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    reach: 1.1 + random() * 1.5,
    bend: (random() - 0.5) * 0.9,
    phase: random(),
    speed: 1 / (16 + random() * 14),
  }));
}

/**
 * Position along a path at p in [0, 1] (0 = start beyond the edge, 1 = the target).
 * A quadratic bezier bent sideways, plus a wobble that calms as it arrives.
 * Mirrors `pathPoint` in the vertex shader; keep the two in step.
 */
export function pathPoint(seed: PathSeed, p: number, target: Point, aspect: number): Point {
  const dirX = Math.cos(seed.angle);
  const dirY = Math.sin(seed.angle);
  const startX = target.x + dirX * seed.reach * Math.max(aspect, 1);
  const startY = target.y + dirY * seed.reach;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const ctrlX = (startX + target.x) / 2 + perpX * seed.bend * dist;
  const ctrlY = (startY + target.y) / 2 + perpY * seed.bend * dist;
  const q = 1 - p;
  const wobble = Math.sin(p * Math.PI * 2 * WOBBLE_FREQUENCY + seed.phase * Math.PI * 2) * WOBBLE_AMPLITUDE * q * dist;
  return {
    x: q * q * startX + 2 * q * p * ctrlX + p * p * target.x + perpX * wobble,
    y: q * q * startY + 2 * q * p * ctrlY + p * p * target.y + perpY * wobble,
  };
}

/** Radius of contour ring `index` at angle theta (a gently irregular, topographic loop). */
export function contourRadius(index: number, theta: number, breath = 0): number {
  const base = 0.07 + index * 0.075;
  const wobble = 0.07 * Math.sin(3 * theta + index * 0.9) + 0.045 * Math.sin(5 * theta - index * 1.7 + breath);
  return base * (1 + wobble);
}

const round = (value: number) => Math.round(value);

export interface PosterGeometry {
  width: number;
  height: number;
  target: Point;
  paths: string[];
  contours: string[];
}

/** SVG path data for the static poster (server-rendered, reduced-motion and pre-WebGL view). */
export function buildPoster(layout: FieldLayout, aspect: number, pathCount = 44, ringCount = 12): PosterGeometry {
  const height = 1000;
  const width = Math.round(height * aspect);
  const target = targetInField(layout, aspect);
  const toSvg = (point: Point) => ({
    x: round(((point.x / aspect + 1) / 2) * width),
    y: round(((1 - point.y) / 2) * height),
  });

  const paths = makePathSeeds(pathCount, 11).map((seed) => {
    const steps = 20;
    const points = Array.from({ length: steps + 1 }, (_, i) => toSvg(pathPoint(seed, (i / steps) * 0.94, target, aspect)));
    return points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x} ${pt.y}`).join("");
  });

  const contours = Array.from({ length: ringCount }, (_, index) => {
    const steps = 48;
    const points = Array.from({ length: steps }, (_, i) => {
      const theta = (i / steps) * Math.PI * 2;
      const r = contourRadius(index, theta);
      return toSvg({ x: target.x + Math.cos(theta) * r, y: target.y + Math.sin(theta) * r });
    });
    return `${points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x} ${pt.y}`).join("")}Z`;
  });

  return { width, height, target: toSvg(target), paths, contours };
}
