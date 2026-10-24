/**
 * Simulated time for the demo. WAYFINDER_SIM_TIME_SCALE (number >= 1) compresses
 * waiting periods: 1440 means one simulated day passes per real minute.
 * Default 1 = real time.
 */

export interface Clock {
  now(): Date;
  scale: number;
}

/** Invalid, empty, non-numeric, non-finite or < 1 values fall back to 1. Never throws. */
export function parseTimeScale(raw: string | undefined): number {
  if (raw === undefined || raw === null) return 1;
  const trimmed = String(raw).trim();
  if (trimmed === '') return 1;
  // Number() rejects trailing garbage ("12abc" -> NaN), unlike parseFloat.
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/** anchor + (deadline - anchor) / scale. */
export function scaleDeadline(anchor: Date, deadline: Date, scale: number): Date {
  const s = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  const a = anchor.getTime();
  return new Date(a + (deadline.getTime() - a) / s);
}

export function systemClock(
  env: Record<string, string | undefined> = process.env,
): Clock {
  return {
    now: () => new Date(),
    scale: parseTimeScale(env.WAYFINDER_SIM_TIME_SCALE),
  };
}
