"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

const TOASTER_DELAY_MS = 1500;

/**
 * App-wide client providers: motion respects the OS reduced-motion setting,
 * one Toaster, one tooltip delay. Theme lives on <html data-theme> (see theme.ts),
 * so it needs no React provider.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Toasts only follow a user action, so the Toaster (sonner) loads after first paint.
  const [Toaster, setToaster] = useState<ComponentType | null>(null);
  useEffect(() => {
    let isCancelled = false;
    const id = setTimeout(() => {
      import("@/components/ui/toast")
        .then((mod) => {
          if (!isCancelled) setToaster(() => mod.Toaster);
        })
        .catch(() => {
          // No toasts if the chunk fails to load; the rest of the app is unaffected.
        });
    }, TOASTER_DELAY_MS);
    return () => {
      isCancelled = true;
      clearTimeout(id);
    };
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipPrimitive.Provider delayDuration={250}>
        {children}
        {Toaster ? <Toaster /> : null}
      </TooltipPrimitive.Provider>
    </MotionConfig>
  );
}
