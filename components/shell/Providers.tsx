"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Toaster } from "@/components/ui/toast";

/**
 * App-wide client providers: motion respects the OS reduced-motion setting,
 * one Toaster, one tooltip delay. Theme lives on <html data-theme> (see theme.ts),
 * so it needs no React provider.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipPrimitive.Provider delayDuration={250}>
        {children}
        <Toaster />
      </TooltipPrimitive.Provider>
    </MotionConfig>
  );
}
