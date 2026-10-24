"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applySwarmEvent, buildSwarmSchedule, initialSwarm } from "@/lib/motion/simulate";
import type { SwarmAgent } from "@/lib/motion/status";

/** Walks the scripted swarm run with timers; clears them on reset and unmount. */
export function useSwarmSimulation() {
  const [agents, setAgents] = useState<SwarmAgent[]>(initialSwarm);
  const [isRunning, setIsRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const reset = useCallback(() => {
    clear();
    setIsRunning(false);
    setAgents(initialSwarm());
  }, [clear]);

  const start = useCallback(() => {
    clear();
    setAgents(initialSwarm());
    setIsRunning(true);
    const schedule = buildSwarmSchedule();
    timers.current = schedule.map((event) =>
      window.setTimeout(() => setAgents((current) => applySwarmEvent(current, event)), event.at),
    );
    const last = schedule[schedule.length - 1]?.at ?? 0;
    timers.current.push(window.setTimeout(() => setIsRunning(false), last + 50));
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { agents, isRunning, start, reset };
}
