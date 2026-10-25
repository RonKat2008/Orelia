"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";

type Props = { children: ReactNode; className?: string };

/** Same values as `--animate-page-enter` / `@keyframes page-enter` in app/styles/theme.css. */
const PAGE_ENTER: Keyframe[] = [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }];
const PAGE_ENTER_TIMING: KeyframeAnimationOptions = { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

/**
 * Enter-only page transition on client-side navigation: a short rise and fade (DISTANCE.sm over DURATION.normal with
 * EASE.arrive, see lib/motion/tokens.ts).
 * - The animation is replayed on the SAME element (Web Animations API, compositor-only opacity/transform). It used to
 *   be `key={pathname}`, which remounted the whole app below the root layout on every navigation: the case layout's
 *   JourneyShell, every client component and their data were thrown away and refetched on each stage switch.
 * - The first page a visitor lands on is server-rendered fully visible; only client-side navigations animate.
 * - Started in a layout effect, before paint, so the new page never flashes in at full opacity first.
 * - Reduced motion: no animation.
 */
export function PageTransition({ children, className }: Props) {
  const pathname = usePathname();
  const reduced = useReducedMotionGate();
  const [landingPath] = useState(pathname);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || pathname === landingPath || typeof el.animate !== "function") return;
    const animation = el.animate(PAGE_ENTER, PAGE_ENTER_TIMING);
    return () => animation.cancel();
  }, [pathname, reduced, landingPath]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
