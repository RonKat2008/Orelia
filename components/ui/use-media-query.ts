"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a media query without setState-in-effect. Returns `serverValue`
 * during SSR and the first client render pass, then the live match.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const DESKTOP_QUERY = "(min-width: 768px)";
