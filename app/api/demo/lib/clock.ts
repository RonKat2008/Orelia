import fs from "node:fs";
import path from "node:path";
import { addBusinessDays } from "@/lib/workflows/business-days";
import { parseTimeScale } from "@/lib/workflows/clock";
import { statePath } from "@/scripts/demo/state";

export interface SimClock {
  anchor: string;
  /** Simulated milliseconds added on top of the anchor. */
  offsetMs: number;
  simulatedNow: string;
  /** True once the offset covers three business days — the first follow-up. */
  day3FollowUpOpen: boolean;
  scale: number;
}

interface Stored {
  anchor: string;
  offsetMs: number;
}

function clockPath(env: Record<string, string | undefined>): string {
  return path.join(path.dirname(statePath(env)), "sim-clock.json");
}

function read(env: Record<string, string | undefined>): Stored | null {
  try {
    return JSON.parse(fs.readFileSync(clockPath(env), "utf8")) as Stored;
  } catch {
    return null;
  }
}

function write(env: Record<string, string | undefined>, stored: Stored): void {
  const file = clockPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored, null, 2));
}

function view(stored: Stored, env: Record<string, string | undefined>): SimClock {
  const anchor = new Date(stored.anchor);
  const day3 = addBusinessDays(anchor, 3).getTime() - anchor.getTime();
  const simulated = new Date(anchor.getTime() + stored.offsetMs);
  return {
    anchor: stored.anchor,
    offsetMs: stored.offsetMs,
    simulatedNow: simulated.toISOString(),
    day3FollowUpOpen: stored.offsetMs >= day3,
    scale: parseTimeScale(env.WAYFINDER_SIM_TIME_SCALE),
  };
}

export function readSimClock(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): SimClock {
  const stored = read(env) ?? { anchor: now.toISOString(), offsetMs: 0 };
  return view(stored, env);
}

/** Jump the demo clock forward by three business days (the first follow-up). */
export function advanceToDay3(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): SimClock {
  const stored = read(env) ?? { anchor: now.toISOString(), offsetMs: 0 };
  const anchor = new Date(stored.anchor);
  const step = addBusinessDays(anchor, 3).getTime() - anchor.getTime();
  const next = { anchor: stored.anchor, offsetMs: stored.offsetMs + step };
  write(env, next);
  return view(next, env);
}
