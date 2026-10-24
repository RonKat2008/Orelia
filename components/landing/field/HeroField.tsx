"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";
import { useHeroMotion } from "../HeroMotion";

const FieldCanvas = dynamic(() => import("./FieldCanvas"), { ssr: false });

/** Waits for the page to settle (idle, or a short timeout) before pulling in WebGL. */
const IDLE_TIMEOUT_MS = 1200;

/**
 * Mounts the live field over the server-rendered poster once the browser is idle.
 * Reduced motion: never loads; the poster is the experience.
 */
export function HeroField() {
  const reduced = useReducedMotionGate();
  const { isPaused } = useHeroMotion();
  const [shouldLoad, setShouldLoad] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    const start = () => setShouldLoad(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(start, IDLE_TIMEOUT_MS / 2);
    return () => clearTimeout(id);
  }, [reduced]);

  const handleReady = useCallback(() => {
    setIsLive(true);
    layerRef.current?.closest("[data-hero]")?.setAttribute("data-field", "live");
  }, []);

  useEffect(() => {
    const hero = layerRef.current?.closest("[data-hero]");
    return () => hero?.removeAttribute("data-field");
  }, []);

  if (reduced) return null;

  return (
    <div
      ref={layerRef}
      aria-hidden
      className={cn(
        "absolute inset-0 opacity-0 transition-opacity duration-[1600ms] ease-out-expo motion-reduce:transition-none",
        isLive && "opacity-100",
      )}
    >
      {shouldLoad ? <FieldCanvas isPaused={isPaused} onReady={handleReady} /> : null}
    </div>
  );
}
