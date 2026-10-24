/**
 * Wayfinder motion tokens. Every duration, easing, spring and distance used by
 * components/motion comes from here — no inline numbers in components.
 *
 * Motion (motion/react) takes seconds; anime.js v4 takes milliseconds. Both are
 * derived from the same table so the two engines feel like one system.
 */

export const DURATION = {
  instant: 0.08,
  fast: 0.18,
  normal: 0.35,
  slow: 0.6,
  route: 1.1,
  crawl: 1.6,
} as const;

export type DurationToken = keyof typeof DURATION;

/** Milliseconds for anime.js. */
export function durationMs(token: DurationToken): number {
  return Math.round(DURATION[token] * 1000);
}

/** Cubic-bezier control points for motion/react. */
export const EASE = {
  /** Calm deceleration: the default for anything arriving. */
  arrive: [0.22, 1, 0.36, 1],
  /** Symmetric, for things that change in place. */
  settle: [0.45, 0, 0.55, 1],
  /** For things leaving: quick, unobtrusive. */
  depart: [0.4, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** anime.js v4 named eases matching the curves above as closely as possible. */
export const ANIME_EASE = {
  arrive: "outQuart",
  settle: "inOutSine",
  depart: "inQuad",
  draw: "inOutCubic",
} as const;

/** Spring presets for motion/react. Gentle, never bouncy: users are anxious. */
export const SPRING = {
  snappy: { type: "spring", stiffness: 320, damping: 32 },
  gentle: { type: "spring", stiffness: 140, damping: 20 },
  layout: { type: "spring", stiffness: 220, damping: 30, mass: 0.9 },
} as const;

/** anime.js v4 spring parameters (createSpring) for the "settle on done" beat. */
export const ANIME_SPRING = {
  settle: { mass: 1, stiffness: 120, damping: 12, velocity: 0 },
} as const;

export const STAGGER = {
  /** Between list items (seconds). Kept within 0.05–0.10. */
  list: 0.06,
  /** Between waypoints on the route header (ms). */
  waypoint: 140,
  /** Delay before the first child enters (seconds). */
  lead: 0.05,
} as const;

/** Translation distances in px. */
export const DISTANCE = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 24,
} as const;

export const SCALE = {
  press: 0.97,
  settleFrom: 1.28,
  pulseTo: 1.9,
  breatheTo: 1.18,
} as const;

/** Opacity levels for quiet states. */
export const OPACITY = {
  failed: 0.62,
  notImplemented: 0.42,
  halo: 0.45,
  haloRest: 0.18,
} as const;
