"use client";

import { useId, useState } from "react";
import { RotateCcw } from "lucide-react";
import { RANKING_WEIGHTS, type RankingWeights } from "@/config/ranking";
import { Button } from "@/components/ui";
import { FACTOR_COPY, RANKING_FACTORS, RANKING_FORMULA } from "./model";

export interface WeightsPanelProps {
  weights?: RankingWeights;
  defaults?: RankingWeights;
  onChange: (weights: RankingWeights) => void;
}

/** A calm panel of four sliders. Meant to sit in a side column or a Sheet. */
export function WeightsPanel({ weights: controlled, defaults = RANKING_WEIGHTS, onChange }: WeightsPanelProps) {
  const [internal, setInternal] = useState<RankingWeights>(defaults);
  const weights = controlled ?? internal;
  const baseId = useId();

  function update(next: RankingWeights) {
    if (!controlled) setInternal(next);
    onChange(next);
  }

  return (
    <section aria-labelledby={`${baseId}-title`} className="grid gap-6">
      <header className="grid gap-2">
        <h2
          id={`${baseId}-title`}
          className="m-0 font-display text-h3 font-normal text-ink display-soft"
        >
          How we order <em className="emph">fit</em>
        </h2>
        <p className="m-0 text-small text-ink-2 text-pretty">{RANKING_FORMULA}</p>
      </header>
      <div className="grid gap-6">
        {RANKING_FACTORS.map((factor) => {
          const copy = FACTOR_COPY[factor];
          const inputId = `${baseId}-${factor}`;
          const helpId = `${inputId}-help`;
          return (
            <div key={factor} className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={inputId} className="text-body font-semibold text-ink">
                  {copy.label}
                </label>
                <output htmlFor={inputId} className="font-display text-h4 tabular-nums text-teal">
                  {weights[factor]}
                </output>
              </div>
              <input
                id={inputId}
                type="range"
                min={0}
                max={100}
                step={1}
                value={weights[factor]}
                aria-describedby={helpId}
                onChange={(event) => update({ ...weights, [factor]: Number(event.target.value) })}
                className="h-11 w-full cursor-pointer accent-teal focus-ring"
              />
              <p id={helpId} className="m-0 text-small text-ink-2 text-pretty">
                {copy.help}
              </p>
            </div>
          );
        })}
      </div>
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => update({ ...defaults })}>
          <RotateCcw aria-hidden />
          Reset to defaults
        </Button>
      </div>
    </section>
  );
}
