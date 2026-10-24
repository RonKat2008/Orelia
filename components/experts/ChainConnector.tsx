"use client";

import { motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";

/**
 * Line between two chain nodes. Horizontal on wide screens, vertical below. The path draws in with pathLength;
 * with reduced motion it is rendered complete immediately.
 */
export function ChainConnector({ delay }: { delay: number }) {
  const reduced = useReducedMotionGate();
  const motionProps = reduced
    ? { initial: false as const, animate: { pathLength: 1, opacity: 1 } }
    : {
        initial: { pathLength: 0, opacity: 0.4 },
        whileInView: { pathLength: 1, opacity: 1 },
        viewport: { once: true, margin: "-40px" },
        transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
      };
  return (
    <div aria-hidden className="grid place-items-center text-teal">
      <svg viewBox="0 0 24 48" className="h-10 w-6 xl:hidden" fill="none">
        <motion.path d="M12 2 V40" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...motionProps} />
        <path d="M6 36 L12 44 L18 36" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 48 24" className="hidden h-6 w-12 xl:block" fill="none">
        <motion.path d="M2 12 H40" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...motionProps} />
        <path d="M36 6 L44 12 L36 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
