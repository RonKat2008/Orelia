"use client";

import { useEffect, useState, type ComponentType } from "react";

/** Matches Tailwind's `lg` breakpoint, where the sticky stage is shown. */
export const STEP_FRAMES_QUERY = "(min-width: 1024px)";

/**
 * Client island for the How-it-works sticky stage. The stage repeats every step's
 * vignette (phones show them inline instead), so it is left out of the HTML and
 * loaded only on wide screens, as soon as the page hydrates.
 */
export function StepFramesIsland() {
  const [Frames, setFrames] = useState<ComponentType | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const query = window.matchMedia(STEP_FRAMES_QUERY);
    const load = () => {
      if (!query.matches) return;
      query.removeEventListener("change", load);
      import("./StepFrames")
        .then((mod) => {
          if (!isCancelled) setFrames(() => mod.default);
        })
        .catch(() => {
          // The steps still read in full; only the illustration stage is missing.
        });
    };
    load();
    query.addEventListener("change", load);
    return () => {
      isCancelled = true;
      query.removeEventListener("change", load);
    };
  }, []);

  return Frames ? <Frames /> : null;
}
