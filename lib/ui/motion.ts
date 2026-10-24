import type { Transition } from "motion/react";

/**
 * Warm Paper motion tokens (JS side). The CSS side lives in app/styles/theme.css
 * (--duration-*, --ease-out-expo). Motion clarifies flow; it never decorates.
 */
export const DURATION = {
  fast: 0.15,
  base: 0.3,
  slow: 0.5,
  slower: 0.7,
} as const;

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** Spring presets for motion/react. All settle without visible overshoot except `lively`. */
export const SPRING = {
  /** Default for layout shifts, cards arriving, panels. */
  gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  /** Larger surfaces: sheets, dialogs, page sections. */
  soft: { type: "spring", stiffness: 120, damping: 22, mass: 1.1 },
  /** Small controls: toggles, chips, indicators. */
  snappy: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 },
  /** Rare, celebratory moments (a step completed). A touch of overshoot. */
  lively: { type: "spring", stiffness: 260, damping: 18, mass: 0.9 },
} as const satisfies Record<string, Transition>;

export const TWEEN = {
  fast: { duration: DURATION.fast, ease: EASE_OUT_EXPO },
  base: { duration: DURATION.base, ease: EASE_OUT_EXPO },
  slow: { duration: DURATION.slow, ease: EASE_OUT_EXPO },
} as const satisfies Record<string, Transition>;

/** Standard "arrive" variants: a short rise and fade. Pair with MotionConfig reducedMotion="user". */
export const RISE = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: TWEEN.slow },
} as const;
