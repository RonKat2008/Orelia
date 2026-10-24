"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";

const RISE_PX = 8;
const ENTER_S = 0.3;
const LEAVE_S = 0.2;
const REDUCED_FADE_S = 0.1;

/**
 * The next question fades in and rises 8 px in 300 ms; the old one leaves at 200 ms.
 * Under reduced motion it is a 100 ms fade with no movement (docs/DESIGN-v2.md section 9).
 */
export function StepTransition({
  stepKey,
  children,
}: {
  stepKey: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotionGate();
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={stepKey}
        initial={{ opacity: 0, y: reduced ? 0 : RISE_PX }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: reduced ? REDUCED_FADE_S : ENTER_S,
            ease: "easeOut",
          },
        }}
        exit={{
          opacity: 0,
          y: 0,
          transition: { duration: reduced ? REDUCED_FADE_S : LEAVE_S },
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
