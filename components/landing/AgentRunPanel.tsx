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
 * The hero's "agents at work" panel, animated: a scripted, clearly labelled illustrative run.
 * Agents tick to done, source chips land, the curator picks a best fit, then a draft waits
 * for approval. Reduced motion shows the finished state, still. Loaded lazily by
 * AgentRunIsland over the server-rendered first frame.
 */
export default function AgentRunPanel({ className }: { className?: string }) {
  const reduced = useReducedMotionGate();
  const { isPaused } = useHeroMotion();
  const rootRef = useRef<HTMLElement>(null);
  const isOnScreen = useOnScreen(rootRef);
  const [keyframe, setKeyframe] = useState(0);
  const [hasTriedApprove, setHasTriedApprove] = useState(false);

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
      isPaused={isPaused}
      hasTriedApprove={hasTriedApprove}
      onApprove={() => setHasTriedApprove(true)}
      rootRef={rootRef}
      className={className}
    />
  );
}
