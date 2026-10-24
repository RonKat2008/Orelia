"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";
import { isCapableForAutoMotion, onFirstInteraction, readDeviceSignals, whenIdleAfterLoad } from "@/lib/ui/defer";
import { useHeroMotion } from "../HeroMotion";

type FieldCanvasComponent = ComponentType<{ isPaused: boolean; onReady: () => void }>;

/**
 * Mounts the live field over the server-rendered poster, off the critical path:
 * - large, capable devices (wide viewport, fine pointer, not low-end): after `load`, when idle;
 * - phones, tablets and low-end devices: only after the visitor's first interaction.
 * Reduced motion: never loads; the poster is the experience. No WebGL: the poster stays.
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
    // A plain dynamic import (not next/dynamic) so the ogl chunk is never preloaded in the
    // initial HTML.
    const start = () => {
      import("./FieldCanvas")
        .then((mod) => {
          if (!isCancelled) setCanvas(() => mod.default);
        })
        .catch(() => {
          // The static poster stays as the hero art.
        });
    };
    const cancel = isCapableForAutoMotion(readDeviceSignals())
      ? whenIdleAfterLoad(start)
      : onFirstInteraction(start);
    return () => {
      isCancelled = true;
      cancel();
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
