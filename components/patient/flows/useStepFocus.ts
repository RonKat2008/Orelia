"use client";

import { useEffect, useRef } from "react";

/**
 * Moves focus to the new screen's heading when a one-question-per-screen flow changes step, so keyboard and screen
 * reader users land on the new question. The first screen keeps the page's normal focus.
 */
export function useStepFocus<T extends HTMLElement>(step: string) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Wait a frame: the step transition mounts the new screen after the old one leaves.
    const timer = window.setTimeout(() => {
      const heading = ref.current?.querySelector<HTMLElement>("h1, h2, h3");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [step]);
  return ref;
}
