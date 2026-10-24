import type { ScoreBreakdownItem } from "@/lib/contracts";

export interface ScoreSegment {
  factor: string;
  points: number;
  text: string;
  evidenceCount: number;
  /** Fraction 0–1 where this segment starts on the bar. */
  start: number;
  /** Fraction 0–1 of the bar this segment covers (0 for non-positive points). */
  size: number;
  /** Index in the palette cycle for positive segments; -1 for deductions. */
  tone: number;
}

export const SCORE_TONES = 4;

/**
 * Lays positive factors end to end on a bar scaled to `max` (defaults to the
 * positive total). Deductions keep their row in the legend but take no bar space.
 * Returns new objects; input is never mutated.
 */
export function computeScoreSegments(items: readonly ScoreBreakdownItem[], max?: number): ScoreSegment[] {
  const positiveTotal = items.reduce((sum, item) => sum + Math.max(0, item.points), 0);
  const scale = max && max > 0 ? Math.max(max, positiveTotal) : positiveTotal;
  let cursor = 0;
  let toneIndex = 0;
  return items.map((item) => {
    const positive = item.points > 0 && scale > 0;
    const size = positive ? item.points / scale : 0;
    const segment: ScoreSegment = {
      factor: item.factor,
      points: item.points,
      text: item.text,
      evidenceCount: item.evidenceIds.length,
      start: cursor,
      size,
      tone: positive ? toneIndex++ % SCORE_TONES : -1,
    };
    cursor += size;
    return segment;
  });
}

export function formatPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
