/**
 * Reduced-motion gate. Pure and SSR-safe: nothing touches `window` at import.
 *
 * Contract: when reduced motion is on, every component renders its FINAL state
 * immediately — no transforms, no draws, no pulses, zero-duration transitions.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MatchMedia = (query: string) => Pick<MediaQueryList, "matches"> &
  Partial<Pick<MediaQueryList, "addEventListener" | "removeEventListener">>;

function getMatchMedia(): MatchMedia | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia.bind(window);
}

/** Reads the user's preference. Returns false when it cannot be known (SSR). */
export function readPrefersReducedMotion(matchMedia: MatchMedia | null = getMatchMedia()): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Subscribes to preference changes; returns an unsubscribe. No-op on the server. */
export function subscribeReducedMotion(
  onChange: () => void,
  matchMedia: MatchMedia | null = getMatchMedia(),
): () => void {
  if (!matchMedia) return () => {};
  const list = matchMedia(REDUCED_MOTION_QUERY);
  if (typeof list.addEventListener !== "function") return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener?.("change", onChange);
}

/** Picks the animated or the reduced value. */
export function pickMotion<T>(reduced: boolean, animated: T, still: T): T {
  return reduced ? still : animated;
}

/** A transition that completes instantly; used whenever reduced motion is on. */
export const INSTANT_TRANSITION = { duration: 0 } as const;
