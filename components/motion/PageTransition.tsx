"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { enterVariants } from "@/lib/motion/variants";
import { DISTANCE } from "@/lib/motion/tokens";

type Props = { children: ReactNode; className?: string };

/**
 * Enter-only page transition keyed on the pathname. App Router swaps the
 * children before an exit could play (the outgoing tree is already gone), so
 * an exit animation would animate the NEW page out; we deliberately only
 * animate arrival. Use inside a layout or template.
 */
export function PageTransition({ children, className }: Props) {
  const pathname = usePathname();
  const reduced = useReducedMotionGate();
  return (
    <motion.div
      key={pathname}
      className={className}
      variants={enterVariants(reduced, DISTANCE.sm)}
      initial={reduced ? false : "hidden"}
      animate="visible"
    >
      {children}
    </motion.div>
  );
}
