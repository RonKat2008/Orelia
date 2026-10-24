import type { TargetAndTransition, Transition } from "motion/react";
import { DISTANCE, DURATION, EASE, SPRING, STAGGER } from "./tokens";
import { INSTANT_TRANSITION } from "./reduced-motion";

/**
 * Variant factories for motion/react. Each takes `reduced` and, when it is true,
 * returns variants whose hidden state equals the visible state with an instant
 * transition — i.e. the final state renders immediately.
 */

export type EnterVariants = {
  hidden: TargetAndTransition;
  visible: TargetAndTransition;
  exit: TargetAndTransition;
};

export function enterVariants(reduced: boolean, distance: number = DISTANCE.md): EnterVariants {
  if (reduced) {
    const still = { opacity: 1, y: 0, transition: INSTANT_TRANSITION };
    return { hidden: still, visible: still, exit: { opacity: 0, y: 0, transition: INSTANT_TRANSITION } };
  }
  return {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0, transition: { duration: DURATION.normal, ease: EASE.arrive } },
    exit: { opacity: 0, y: -DISTANCE.xs, transition: { duration: DURATION.fast, ease: EASE.depart } },
  };
}

/** Per-item entrance delay, capped so long lists never feel sluggish. */
export const STAGGER_CAP = 8;

export function staggerDelay(reduced: boolean, index: number): number {
  if (reduced) return 0;
  return STAGGER.lead + Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER.list;
}

export function layoutTransition(reduced: boolean): Transition {
  return reduced ? INSTANT_TRANSITION : SPRING.layout;
}

/** Evidence reveal: a top-down clip wipe plus fade. clip-path is compositor-friendly. */
export function revealVariants(reduced: boolean): EnterVariants {
  if (reduced) {
    const open = { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", transition: INSTANT_TRANSITION };
    return { hidden: open, visible: open, exit: { opacity: 0, transition: INSTANT_TRANSITION } };
  }
  return {
    hidden: { opacity: 0, y: -DISTANCE.xs, clipPath: "inset(0% 0% 100% 0%)" },
    visible: {
      opacity: 1,
      y: 0,
      clipPath: "inset(0% 0% 0% 0%)",
      transition: { duration: DURATION.normal, ease: EASE.arrive },
    },
    exit: {
      opacity: 0,
      clipPath: "inset(0% 0% 100% 0%)",
      transition: { duration: DURATION.fast, ease: EASE.depart },
    },
  };
}

/** Score bar segment: grows from its left edge via scaleX. */
export function segmentTransition(reduced: boolean, index: number): Transition {
  return reduced
    ? INSTANT_TRANSITION
    : { duration: DURATION.slow, ease: EASE.arrive, delay: STAGGER.lead + index * STAGGER.list };
}
