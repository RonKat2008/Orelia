"use client";

import "./motion.css";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { enterVariants, layoutTransition, staggerDelay } from "@/lib/motion/variants";

type Props<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Animate re-ordering with layout animations (shortlist re-rank). Default true. */
  reorder?: boolean;
  as?: "ul" | "ol";
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
};

/**
 * A list whose items arrive in a short stagger, leave with a quick fade, and
 * glide to new positions when the order changes. With reduced motion every item
 * renders in place immediately.
 */
export function StaggerList<T>({
  items,
  getKey,
  renderItem,
  reorder = true,
  as = "ul",
  className,
  itemClassName,
  "aria-label": ariaLabel,
}: Props<T>) {
  const reduced = useReducedMotionGate();
  const List = as === "ol" ? motion.ol : motion.ul;
  const item = enterVariants(reduced);
  const layout = reorder && !reduced ? "position" : false;

  return (
    <List
      className={["wf-stagger", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      <AnimatePresence mode="popLayout">
        {items.map((entry, index) => (
          <motion.li
            key={getKey(entry)}
            className={itemClassName}
            layout={layout}
            variants={{ ...item, visible: (i: number) => ({ ...item.visible, transition: { ...item.visible.transition, delay: staggerDelay(reduced, i) } }) }}
            custom={index}
            initial={reduced ? false : "hidden"}
            animate="visible"
            exit="exit"
            transition={{ layout: layoutTransition(reduced) }}
          >
            {renderItem(entry, index)}
          </motion.li>
        ))}
      </AnimatePresence>
    </List>
  );
}
