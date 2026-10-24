"use client";

import { useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { SPRING } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/cn";
import type { EvidenceLevel } from "@/lib/condition-brief/contract";
import { EvidenceMarker } from "./Evidence";
import { LEVEL_EXPLAINER, LEVEL_FILTERS, LEVEL_LABEL, type LevelFilter } from "./model";

export interface LevelLegendProps {
  value: LevelFilter;
  onChange: (value: LevelFilter) => void;
  counts?: Partial<Record<LevelFilter, number>>;
}

const LEVELS: EvidenceLevel[] = ["established", "emerging", "uncertain"];

/** Segmented radiogroup that filters statements by evidence level, plus a one-sentence legend per level. */
export function LevelLegend({ value, onChange, counts }: LevelLegendProps) {
  const reduced = useReducedMotionGate();
  const refs = useRef<Partial<Record<LevelFilter, HTMLButtonElement | null>>>({});

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = LEVEL_FILTERS.indexOf(value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = LEVEL_FILTERS[(i + step + LEVEL_FILTERS.length) % LEVEL_FILTERS.length];
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="grid gap-5" data-testid="level-legend">
      <div className="grid gap-2">
        <p id="level-filter-label" className="m-0 text-micro text-ink-3">
          Show statements that are
        </p>
        <div
          role="radiogroup"
          aria-labelledby="level-filter-label"
          onKeyDown={onKeyDown}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-pill border border-line bg-paper-2 p-1 shadow-inset"
        >
          {LEVEL_FILTERS.map((level) => {
            const active = level === value;
            const count = counts?.[level];
            return (
              <button
                key={level}
                ref={(el) => {
                  refs.current[level] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onChange(level)}
                className={cn(
                  "relative isolate inline-flex min-h-9 items-center gap-1.5 rounded-pill px-4 text-small font-semibold focus-ring",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  active ? "text-on-teal" : "text-ink-2 hover:text-ink",
                  reduced && active && "bg-teal",
                )}
              >
                {active && !reduced ? (
                  <motion.span
                    layoutId="level-pill"
                    transition={SPRING.snappy}
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-pill bg-teal shadow-sm"
                  />
                ) : null}
                {LEVEL_LABEL[level]}
                {typeof count === "number" ? (
                  <span className="text-micro opacity-80" aria-label={`${count} items`}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <dl className="m-0 grid gap-3 md:grid-cols-3">
        {LEVELS.map((level) => (
          <div key={level} className="grid content-start gap-1.5 border-t border-line pt-3">
            <dt>
              <EvidenceMarker level={level} />
            </dt>
            <dd className="m-0 text-small text-ink-2">{LEVEL_EXPLAINER[level]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
