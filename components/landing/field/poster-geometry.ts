import {
  createRandom,
  makeParticleSeeds,
  particleFade,
  particlePoint,
  planRingAngles,
  legibilityMask,
  targetInField,
  type FieldLayout,
  type Point,
} from "./geometry";

/**
 * Geometry for the static SVG poster: a still of the convergence field, drawn as short
 * dotted trails along the same spiral paths the shader uses. Positions are percentages of
 * the hero box so the poster lines up with the live canvas at any size; dot radii and the
 * plan ring are in CSS px so they stay round.
 */

export interface PosterDot {
  /** Percent of hero width / height. */
  x: number;
  y: number;
  /** Radius, CSS px. */
  r: number;
  opacity: number;
  /** Index into SOURCE_TYPES. */
  type: number;
}

export interface PosterGeometry {
  /** Centre, percent of hero width / height. */
  target: Point;
  dots: PosterDot[];
  /** Settled plan points, CSS px offsets from the centre. */
  plan: Point[];
  ringPx: number;
  glowPx: number;
}

const DOTS_PER_TRAIL = 5;
const TRAIL_SPACING = 0.045;
const MIN_OPACITY = 0.04;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function toPercent(point: Point, aspect: number): Point {
  return { x: round2(((point.x / aspect + 1) / 2) * 100), y: round2(((1 - point.y) / 2) * 100) };
}

/** Builds the poster for one layout at a reference hero aspect ratio (width / height). */
export function buildPoster(
  layout: FieldLayout,
  aspect: number,
  trailCount: number,
  /** Reference hero height in CSS px, for the legibility mask. */
  heightPx = 900,
): PosterGeometry {
  const target = targetInField(layout, aspect);
  const random = createRandom(31);
  const dots: PosterDot[] = [];

  for (const seed of makeParticleSeeds(trailCount, 11)) {
    const head = 0.16 + random() * 0.7;
    for (let k = 0; k < DOTS_PER_TRAIL; k += 1) {
      const p = head - k * TRAIL_SPACING;
      if (p <= 0) break;
      const position = toPercent(particlePoint(seed, p, target, aspect), aspect);
      const mask = legibilityMask(layout, (position.y / 100) * heightPx);
      // A still has no motion to catch the eye, so it draws a touch stronger than the live field.
      const opacity = Math.min(seed.alpha * particleFade(p) * (1 - k / DOTS_PER_TRAIL) * mask * 1.5, 0.95);
      if (opacity < MIN_OPACITY) continue;
      dots.push({
        ...position,
        r: round2((0.45 + seed.size / 2) * (1 - k * 0.1)),
        opacity: round2(opacity),
        type: seed.type,
      });
    }
  }

  const plan = planRingAngles().map((angle) => ({
    x: round2(Math.cos(angle) * layout.ringPx),
    y: round2(-Math.sin(angle) * layout.ringPx),
  }));

  return { target: toPercent(target, aspect), dots, plan, ringPx: layout.ringPx, glowPx: layout.glowPx };
}
