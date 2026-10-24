"use client";

import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { enterVariants } from "@/lib/motion/variants";
import { DISTANCE } from "@/lib/motion/tokens";

type Props = { children: ReactNode; className?: string };

/**
 * Enter-only page transition keyed on the pathname.
 * - The first page a visitor lands on is server-rendered fully visible (no
 *   opacity-0 flash before hydration); only client-side navigations animate.
 * - App Router swaps children before an exit could play (the outgoing tree is
 *   already gone), so an exit would animate the NEW page out; we only animate
 *   arrival.
 */
export function PageTransition({ children, className }: Props) {
  const pathname = usePathname();
  const reduced = useReducedMotionGate();
  const [landingPath] = useState(pathname);
  const animateEntry = !reduced && pathname !== landingPath;
  return (
    <motion.div
      key={pathname}
      className={className}
      variants={enterVariants(reduced, DISTANCE.sm)}
      initial={animateEntry ? "hidden" : false}
      animate="visible"
    >
      {children}
    </motion.div>
  );
}
