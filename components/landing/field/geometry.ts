/**
 * Pure geometry for the hero "convergence field": hundreds of sources (papers, trials,
 * centres, aid) stream in from beyond the edges of the hero on gently spiralling paths
 * and merge into one glowing node, where a few points periodically settle into a small
 * ordered ring (the patient's plan). The vertex shaders (shaders.ts) and the static SVG
 * poster (poster-geometry.ts) share this math, so the poster is a faithful still.
 *
 * Field space: x in [-aspect, aspect], y in [-1, 1], y up. One field unit is half the
 * hero height, so distances are isotropic in CSS pixels.
 */

export interface Point {
  x: number;
  y: number;
}

/** Source types, in the order the shader's colour uniforms use. */
export const SOURCE_TYPES = ["paper", "trial", "center", "aid"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface ParticleSeed {
  /** Direction the particle arrives from (its start angle around the centre), radians. */
  angle: number;
  /** Start distance as a multiple (>= 1) of the distance from the centre to the hero edge. */
  reach: number;
  /** Signed spiral turn accumulated on the way in, radians. */
  swirl: number;
  /** 0..1 start offset in the travel cycle. */
  phase: number;
  /** Travel cycles per second. */
  speed: number;
  /** Dot diameter in CSS pixels (1..3). */
  size: number;
  /** Peak opacity (kept low so text over the field stays legible). */
  alpha: number;
  /** Index into SOURCE_TYPES. */
  type: number;
}

/** Normalised (0..1, top-left origin) position of the convergence centre, plus its scale. */
export interface FieldLayout {
  targetX: number;
  targetY: number;
  /** Radius of the settled plan ring, CSS px. */
  ringPx: number;
  /** Radius of the soft glow, CSS px. */
  glowPx: number;
  /** Particles fade out from this many CSS px below the hero top (keeps copy on clean paper)... */
  fadeTopPx: number;
  /** ...reaching zero this many px further down. */
  fadeSpanPx: number;
}

/** Desktop: centred just above the centred headline, so the ring crowns the copy instead of sitting on it. */
export const DESKTOP_LAYOUT: FieldLayout = { targetX: 0.5, targetY: 0.13, ringPx: 26, glowPx: 120, fadeTopPx: 1e5, fadeSpanPx: 1 };
/** Mobile: top-centre, above the headline, so the copy stays on clean paper. */
export const MOBILE_LAYOUT: FieldLayout = { targetX: 0.5, targetY: 0.03, ringPx: 18, glowPx: 84, fadeTopPx: 60, fadeSpanPx: 170 };
export const WIDE_BREAKPOINT_PX = 1024;

export const PARTICLE_COUNT_DESKTOP = 880;
export const PARTICLE_COUNT_LOW_POWER = 300;

/** Arrival easing exponent: higher = more deceleration near the centre. */
export const EASE_POWER = 1.6;
/** Shortest start distance, field units, so particles near an edge still travel. */
export const MIN_TRAVEL = 0.45;
/** Sideways meander amplitude, radians; zero at the edge and on arrival. */
export const MEANDER = 0.14;

/** Each particle draws a short comet trail of ghosts at earlier progress. */
export const TRAIL_POINTS = 4;
export const TRAIL_SPACING = 0.011;

/** Plan ring: how many points settle, and the resolve cycle length in seconds. */
export const PLAN_POINTS = 6;
export const RESOLVE_PERIOD_S = 9;

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
export function targetInField(layout: Pick<FieldLayout, "targetX" | "targetY">, aspect: number): Point {
  return { x: (layout.targetX * 2 - 1) * aspect, y: 1 - layout.targetY * 2 };
}

/** Rough mix of what the agents find: more papers and centres than trials and aid. */
const TYPE_WEIGHTS = [0.34, 0.2, 0.28, 0.18];

function pickType(value: number): number {
  let acc = 0;
  for (let i = 0; i < TYPE_WEIGHTS.length; i += 1) {
    acc += TYPE_WEIGHTS[i];
    if (value < acc) return i;
  }
  return TYPE_WEIGHTS.length - 1;
}

interface Stream {
  angle: number;
  swirl: number;
  reach: number;
  type: number;
}

/** Share of particles that travel in a shared stream; the rest drift in on their own. */
export const STREAM_SHARE = 0.74;
export const STREAM_COUNT = 13;

function makeStreams(random: () => number): Stream[] {
  return Array.from({ length: STREAM_COUNT }, (_, i) => ({
    angle: ((i + random() * 0.6) / STREAM_COUNT) * Math.PI * 2,
    swirl: (random() < 0.85 ? 1 : -1) * (0.7 + random() * 0.8),
    reach: 1.05 + random() * 0.35,
    type: pickType(random()),
  }));
}

/**
 * Seeds for the particles. Most travel in one of a dozen loose streams (each mostly one
 * source type), so the field reads as curved rivers converging; the rest are strays.
 */
export function makeParticleSeeds(count: number, seed = 7): ParticleSeed[] {
  const random = createRandom(seed);
  const streams = makeStreams(random);
  return Array.from({ length: count }, () => {
    const sizeRoll = random();
    const look = {
      phase: random(),
      speed: 1 / (7 + random() * 9),
      size: 1.4 + 1.6 * Math.pow(sizeRoll, 1.5),
      alpha: 0.5 + random() * 0.38,
    };
    if (random() < STREAM_SHARE) {
      const stream = streams[Math.floor(random() * streams.length)];
      const spread = (random() + random() - 1) * 0.065;
      return {
        ...look,
        angle: stream.angle + spread,
        reach: stream.reach + random() * 0.12,
        swirl: stream.swirl + (random() - 0.5) * 0.09,
        type: random() < 0.8 ? stream.type : pickType(random()),
      };
    }
    // Strays: mostly turn the same way, so the field still reads as one gentle vortex.
    const direction = random() < 0.86 ? 1 : -1;
    return {
      ...look,
      angle: random() * Math.PI * 2,
      reach: 1.04 + random() * 0.5,
      swirl: direction * (0.45 + random() * 0.95),
      alpha: look.alpha * 0.75,
      type: pickType(random()),
    };
  });
}

/** Distance from `from` (inside the field) to the field edge along `angle`. */
export function edgeDistance(from: Point, angle: number, aspect: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = Math.abs(dx) < 1e-4 ? Number.POSITIVE_INFINITY : ((dx > 0 ? aspect : -aspect) - from.x) / dx;
  const ty = Math.abs(dy) < 1e-4 ? Number.POSITIVE_INFINITY : ((dy > 0 ? 1 : -1) - from.y) / dy;
  return Math.max(0, Math.min(tx, ty));
}

/** Arrival easing: fast from the edge, settling as it reaches the centre. */
export function easeArrival(p: number): number {
  return 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), EASE_POWER);
}

/** Start distance from the centre for a seed (always at or beyond the hero edge). */
export function startRadius(seed: ParticleSeed, target: Point, aspect: number): number {
  return seed.reach * Math.max(edgeDistance(target, seed.angle, aspect), MIN_TRAVEL);
}

/**
 * Position at progress p in [0, 1] (0 = beyond the edge, 1 = the centre): a spiral whose
 * radius shrinks with the eased progress while the angle turns by `swirl`, with a small
 * meander in the middle of the journey. Mirrors `particlePoint` in shaders.ts; keep in step.
 */
export function particlePoint(seed: ParticleSeed, p: number, target: Point, aspect: number): Point {
  const e = easeArrival(p);
  const radius = startRadius(seed, target, aspect) * (1 - e);
  const theta =
    seed.angle + seed.swirl * e + MEANDER * Math.sin(e * Math.PI * 3 + seed.phase * Math.PI * 2) * 4 * e * (1 - e);
  return { x: target.x + Math.cos(theta) * radius, y: target.y + Math.sin(theta) * radius };
}

/** Legibility mask: 1 above the fade band, 0 below it. */
export function legibilityMask(layout: FieldLayout, fromTopPx: number): number {
  return 1 - smoothstep(layout.fadeTopPx, layout.fadeTopPx + layout.fadeSpanPx, fromTopPx);
}

/** Opacity multiplier along the path: fades in at the edge, out as it merges. Mirrors the shader. */
export function particleFade(p: number): number {
  const e = easeArrival(p);
  const fadeIn = smoothstep(0, 0.06, p);
  const fadeOut = 1 - smoothstep(0.86, 0.99, e);
  return fadeIn * fadeOut * proximityBoost(e);
}

/** Quieter at the far edges, strong through the middle band, brightest at the node. */
export function proximityBoost(e: number): number {
  return 0.72 + 0.6 * smoothstep(0.12, 0.7, e);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Angles of the settled plan ring (evenly spaced, starting at the top). */
export function planRingAngles(count = PLAN_POINTS): number[] {
  return Array.from({ length: count }, (_, i) => Math.PI / 2 + (i / count) * Math.PI * 2);
}
