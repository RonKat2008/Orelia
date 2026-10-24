"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during SSR and hydration, true after: lets a view-dependent subtree wait for the stored choice. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
