"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { enterVariants } from "@/lib/motion/variants";

type Props = {
  /** Content to show; null/false hides it with an exit animation. */
  children: ReactNode;
  /** Changing the key replays the entrance (e.g. a new message). */
  revealKey: string;
  className?: string;
};

/** Presence wrapper for content that appears in answer to an action. */
export function Reveal({ children, revealKey, className }: Props) {
  const reduced = useReducedMotionGate();
  const variants = enterVariants(reduced);
  return (
    <AnimatePresence initial={false} mode="wait">
      {children ? (
        <motion.div
          key={revealKey}
          className={className}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
