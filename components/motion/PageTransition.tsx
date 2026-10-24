"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";

type Props = { children: ReactNode; className?: string };

/**
 * Enter-only page transition keyed on the pathname: a short rise and fade
 * (DISTANCE.sm over DURATION.normal with EASE.arrive, see lib/motion/tokens.ts),
 * done in CSS (`animate-page-enter`, app/styles/theme.css) so the root layout
 * ships no animation runtime.
 * - The first page a visitor lands on is server-rendered fully visible (no
 *   opacity-0 flash before hydration); only client-side navigations animate.
 * - App Router swaps children before an exit could play (the outgoing tree is
 *   already gone), so an exit would animate the NEW page out; we only animate
 *   arrival.
 * - Reduced motion: no animation (JS gate plus `motion-reduce:animate-none`).
 */
export function PageTransition({ children, className }: Props) {
  const pathname = usePathname();
  const reduced = useReducedMotionGate();
  const [landingPath] = useState(pathname);
  const animateEntry = !reduced && pathname !== landingPath;
  return (
    <div key={pathname} className={cn(animateEntry && "animate-page-enter motion-reduce:animate-none", className)}>
      {children}
    </div>
  );
}
