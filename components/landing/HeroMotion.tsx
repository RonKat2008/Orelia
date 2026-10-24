"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { cn } from "@/lib/ui/cn";

interface HeroMotionState {
  /** True when the visitor paused the looping hero motion. */
  isPaused: boolean;
  toggle: () => void;
}

const HeroMotionContext = createContext<HeroMotionState>({ isPaused: false, toggle: () => {} });

/** Shares one pause switch between the WebGL field and the agents panel (WCAG 2.2.2). */
export function HeroMotionProvider({ children }: { children: ReactNode }) {
  const [isPaused, setIsPaused] = useState(false);
  return (
    <HeroMotionContext.Provider value={{ isPaused, toggle: () => setIsPaused((value) => !value) }}>
      {children}
    </HeroMotionContext.Provider>
  );
}

export function useHeroMotion(): HeroMotionState {
  return useContext(HeroMotionContext);
}

/** Visible pause control for the hero's looping motion. Hidden when reduced motion already stills it. */
export function HeroPauseButton({ className }: { className?: string }) {
  const { isPaused, toggle } = useHeroMotion();
  const reduced = useReducedMotionGate();
  if (reduced) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-pressed={isPaused}
      aria-label={isPaused ? "Play animation" : "Pause animation"}
      className={cn("bg-paper/70 text-ink-2 backdrop-blur-sm hover:text-ink", className)}
    >
      {isPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
      {isPaused ? "Play" : "Pause"}
    </Button>
  );
}
