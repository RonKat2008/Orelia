"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { TWEEN } from "@/lib/ui/motion";

export interface FadeEntry {
  key: string;
  node: ReactNode;
}

/** A list whose items fade in and out as the level filter changes. Opacity only; none at all under reduced motion. */
export function FadeList({ entries, className, label }: { entries: readonly FadeEntry[]; className?: string; label?: string }) {
  const reduced = useReducedMotionGate();
  if (reduced) {
    return (
      <ul className={className} aria-label={label}>
        {entries.map((e) => (
          <li key={e.key}>{e.node}</li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={className} aria-label={label}>
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.li
            key={e.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TWEEN.base}
          >
            {e.node}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
