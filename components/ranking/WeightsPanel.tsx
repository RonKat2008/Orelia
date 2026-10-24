"use client";

import { useId, useState } from "react";
import { RANKING_WEIGHTS, type RankingWeights } from "@/config/ranking";
import { FACTOR_COPY, RANKING_FACTORS, RANKING_FORMULA } from "./model";
import styles from "./WeightsPanel.module.css";

export interface WeightsPanelProps {
  weights?: RankingWeights;
  defaults?: RankingWeights;
  onChange: (weights: RankingWeights) => void;
}

export function WeightsPanel({
  weights: controlled,
  defaults = RANKING_WEIGHTS,
  onChange,
}: WeightsPanelProps) {
  const [internal, setInternal] = useState<RankingWeights>(defaults);
  const weights = controlled ?? internal;
  const baseId = useId();

  function update(next: RankingWeights) {
    if (!controlled) setInternal(next);
    onChange(next);
  }

  return (
    <section className={styles.panel} aria-labelledby={`${baseId}-title`}>
      <h2 id={`${baseId}-title`}>Ranking weights</h2>
      <p className={styles.formula}>{RANKING_FORMULA}</p>
      {RANKING_FACTORS.map((factor) => {
        const copy = FACTOR_COPY[factor];
        const inputId = `${baseId}-${factor}`;
        const helpId = `${inputId}-help`;
        return (
          <div className={styles.factor} key={factor}>
            <header>
              <label htmlFor={inputId}>{copy.label}</label>
              <span className={styles.value}>{weights[factor]}</span>
            </header>
            <input
              id={inputId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={weights[factor]}
              aria-describedby={helpId}
              onChange={(event) => {
                update({ ...weights, [factor]: Number(event.target.value) });
              }}
            />
            <p className={styles.help} id={helpId}>
              {copy.help}
            </p>
          </div>
        );
      })}
      <div className={styles.actions}>
        <button type="button" onClick={() => update({ ...defaults })}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
