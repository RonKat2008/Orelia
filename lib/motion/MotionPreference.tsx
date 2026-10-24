"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { readPrefersReducedMotion, subscribeReducedMotion } from "./reduced-motion";

/**
 * Optional override. `null` means "follow the user's OS setting". Tests and the
 * motion lab force a value; production code normally leaves it alone.
 */
const ReducedMotionOverride = createContext<boolean | null>(null);

interface MotionPreferenceProps {
  reducedMotion?: boolean | null;
  children?: ReactNode;
}

export function MotionPreference({ reducedMotion = null, children }: MotionPreferenceProps) {
  return <ReducedMotionOverride.Provider value={reducedMotion}>{children}</ReducedMotionOverride.Provider>;
}

const getServerSnapshot = () => false;
const getSnapshot = () => readPrefersReducedMotion();

/**
 * The single gate every Wayfinder animation goes through. SSR-safe: the server
 * snapshot is `false`, and the real preference is read during hydration via
 * useSyncExternalStore, so there is no hydration mismatch.
 */
export function useReducedMotionGate(): boolean {
  const override = useContext(ReducedMotionOverride);
  const system = useSyncExternalStore(subscribeReducedMotion, getSnapshot, getServerSnapshot);
  return override ?? system;
}
