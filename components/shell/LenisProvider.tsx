"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type Lenis from "lenis";

/** Upper bound on waiting for an idle moment before loading smooth scroll. */
const SMOOTH_SCROLL_IDLE_TIMEOUT_MS = 1500;

const LenisContext = createContext<RefObject<Lenis | null> | null>(null);

/**
 * Smooth scrolling for MARKETING pages only. Wrap a marketing page (not the app)
 * in <LenisProvider>. Never runs for reduced-motion users or touch/coarse pointers.
 * Lenis is driven by the GSAP ticker (autoRaf off) so ScrollTrigger stays in sync.
 */
export function LenisProvider({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduced || coarse) return;

    let isCancelled = false;
    let teardown: (() => void) | undefined;

    // Smooth scroll is an enhancement: load gsap + lenis after first paint, off the critical path.
    const start = async () => {
      const [{ default: LenisCtor }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import("lenis"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (isCancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new LenisCtor({ autoRaf: false, lerp: 0.1, smoothWheel: true });
      lenisRef.current = lenis;

      const onScroll = () => ScrollTrigger.update();
      lenis.on("scroll", onScroll);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      teardown = () => {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33);
        lenis.destroy();
        lenisRef.current = null;
      };
    };

    const run = () => {
      start().catch(() => {
        // Native scrolling still works if the libraries fail to load.
      });
    };
    let cancelIdle: () => void;
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: SMOOTH_SCROLL_IDLE_TIMEOUT_MS });
      cancelIdle = () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(run, SMOOTH_SCROLL_IDLE_TIMEOUT_MS / 2);
      cancelIdle = () => clearTimeout(id);
    }

    return () => {
      isCancelled = true;
      cancelIdle();
      teardown?.();
    };
  }, []);

  return <LenisContext.Provider value={lenisRef}>{children}</LenisContext.Provider>;
}

/** Access the Lenis instance (null when smooth scrolling is disabled). Read it in handlers, not render. */
export function useLenis(): RefObject<Lenis | null> | null {
  return useContext(LenisContext);
}
