"use client";

import "./motion.css";
import { motion } from "motion/react";
import type { ScoreBreakdownItem } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { computeScoreSegments, formatPoints } from "@/lib/motion/score";
import { segmentTransition } from "@/lib/motion/variants";

type Props = {
  items: ScoreBreakdownItem[];
  /** Bar scale; defaults to the sum of positive points. */
  max?: number;
  /** Visible heading for the breakdown. */
  label?: string;
};

/**
 * Why a resource ranks where it does. Each factor is a segment that grows from
 * its left edge (scaleX, compositor-only); the legend below carries the words
 * and points, so the bar is never the only source of the information.
 */
export function ScoreBar({ items, max, label = "Why this ranks here" }: Props) {
  const reduced = useReducedMotionGate();
  const segments = computeScoreSegments(items, max);
  const total = items.reduce((sum, item) => sum + item.points, 0);

  return (
    <section className="wf-score" aria-label={label}>
      <div className="wf-score__head">
        <span className="wf-score__label">{label}</span>
        <span className="wf-score__total">{formatPoints(total).replace(/^\+/, "")} points</span>
      </div>
      <div className="wf-score__track" aria-hidden="true">
        {segments
          .filter((s) => s.size > 0)
          .map((s, i) => (
            <motion.span
              key={s.factor}
              className="wf-score__segment"
              data-score-tone={s.tone}
              style={{ left: `${s.start * 100}%`, width: `${s.size * 100}%`, originX: 0 }}
              initial={reduced ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={segmentTransition(reduced, i)}
            />
          ))}
      </div>
      <dl className="wf-score__legend">
        {segments.map((s) => (
          <div key={s.factor} className="wf-score__row" data-score-tone={s.tone}>
            <dt>
              <span className="wf-score__swatch" aria-hidden="true" />
              {s.text || s.factor}
            </dt>
            <dd>
              <span className="wf-score__points">{formatPoints(s.points)}</span>
              <span className="wf-score__sources">
                {s.evidenceCount === 1 ? "1 source" : `${s.evidenceCount} sources`}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
