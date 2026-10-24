"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";
import { useHeroMotion } from "../HeroMotion";

type FieldCanvasComponent = ComponentType<{ isPaused: boolean; onReady: () => void }>;

/** Waits for the page to settle (idle, or a short timeout) before pulling in WebGL. */
const IDLE_TIMEOUT_MS = 1200;

/**
 * Mounts the live field over the server-rendered poster once the browser is idle.
 * Reduced motion: never loads; the poster is the experience.
 */
export function HeroField() {
  const reduced = useReducedMotionGate();
  const { isPaused } = useHeroMotion();
  const [Canvas, setCanvas] = useState<FieldCanvasComponent | null>(null);
  const [isLive, setIsLive] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    let isCancelled = false;
    // A plain dynamic import (not next/dynamic) so the ogl chunk is not preloaded in the
    // initial HTML: it is fetched only once the page is idle.
    const start = () => {
      import("./FieldCanvas")
        .then((mod) => {
          if (!isCancelled) setCanvas(() => mod.default);
        })
        .catch(() => {
          // The static poster stays as the hero art.
        });
    };
    let cancelIdle: () => void;
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      cancelIdle = () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(start, IDLE_TIMEOUT_MS / 2);
      cancelIdle = () => clearTimeout(id);
    }
    return () => {
      isCancelled = true;
      cancelIdle();
    };
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
      {Canvas ? <Canvas isPaused={isPaused} onReady={handleReady} /> : null}
    </div>
  );
}
