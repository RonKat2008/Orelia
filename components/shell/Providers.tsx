"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { MotionConfigContext } from "motion/react";

const TOASTER_DELAY_MS = 1500;

/**
 * What `<MotionConfig reducedMotion="user">` provides, set on motion's context
 * directly: importing only the context keeps the motion runtime (~50 KB gzipped)
 * out of the root bundle, so pages that animate nothing never download it.
 * Module-level so the value is stable and motion components never re-render for it.
 */
const MOTION_CONFIG = {
  transformPagePoint: (point: { x: number; y: number }) => point,
  isStatic: false,
  reducedMotion: "user",
} as const;

/**
 * App-wide client providers: motion respects the OS reduced-motion setting and
 * one Toaster. Each Tooltip carries its own provider (components/ui/overlay.tsx),
 * so none is mounted here. Theme lives on <html data-theme> (see theme.ts), so it
 * needs no React provider.
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
    <MotionConfigContext.Provider value={MOTION_CONFIG}>
      {children}
      {Toaster ? <Toaster /> : null}
    </MotionConfigContext.Provider>
  );
}
