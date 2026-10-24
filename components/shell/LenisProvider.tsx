"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

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

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true });
    lenisRef.current = lenis;

    const onScroll = () => ScrollTrigger.update();
    lenis.on("scroll", onScroll);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <LenisContext.Provider value={lenisRef}>{children}</LenisContext.Provider>;
}

/** Access the Lenis instance (null when smooth scrolling is disabled). Read it in handlers, not render. */
export function useLenis(): RefObject<Lenis | null> | null {
  return useContext(LenisContext);
}
