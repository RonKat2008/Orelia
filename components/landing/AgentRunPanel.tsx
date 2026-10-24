"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AgentRunPanelView } from "./AgentRunPanelView";
import { useHeroMotion } from "./HeroMotion";
import { FINAL_FRAME, RUN_KEYFRAMES, delayAfter, frameAt, nextKeyframe } from "./run-script";

function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [isOnScreen, setIsOnScreen] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let intersecting = true;
    const update = () => setIsOnScreen(intersecting && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? true;
      update();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return isOnScreen;
}

/**
 * The hero's sample-case card, animated: a scripted, clearly labelled example run. Its one line
 * moves from searching, to found, to plan ready. Reduced motion shows the finished state, still. Loaded lazily by
 * AgentRunIsland over the server-rendered first frame.
 */
export default function AgentRunPanel({ className }: { className?: string }) {
  const reduced = useReducedMotionGate();
  const { isPaused } = useHeroMotion();
  const rootRef = useRef<HTMLElement>(null);
  const isOnScreen = useOnScreen(rootRef);
  const [keyframe, setKeyframe] = useState(0);

  const isRunning = !reduced && !isPaused && isOnScreen;
  useEffect(() => {
    if (!isRunning) return;
    const id = setTimeout(() => setKeyframe((index) => nextKeyframe(index)), delayAfter(keyframe));
    return () => clearTimeout(id);
  }, [isRunning, keyframe]);

  const frame = reduced ? FINAL_FRAME : frameAt(RUN_KEYFRAMES[keyframe] ?? 0);

  return (
    <AgentRunPanelView
      frame={frame}
      rootRef={rootRef}
      className={className}
    />
  );
}
