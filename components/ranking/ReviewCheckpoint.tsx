"use client";

import { useState } from "react";
import type { AgreementSummary, ReviewVerdict } from "./model";
import styles from "./ReviewCheckpoint.module.css";

export interface ReviewResource {
  id: string;
  targetKind: string;
  targetId: string;
  label: string;
  rank?: number;
  score?: number;
}

export interface ReviewSubmit {
  caseId: string;
  reviewer: string;
  targetKind: string;
  targetId: string;
  verdict: ReviewVerdict;
  note?: string;
}

export interface ReviewCheckpointProps {
  caseId: string;
  resources: ReviewResource[];
  agreement?: AgreementSummary[];
  onSubmit: (review: ReviewSubmit) => Promise<void>;
}

const KIND_LABEL: Record<string, string> = {
  expert: "Specialist",
  institution: "Center",
  trial: "Trial",
  organization: "Organization",
};

export function ReviewCheckpoint({ caseId, resources, agreement = [], onSubmit }: ReviewCheckpointProps) {
  const [reviewer, setReviewer] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, ReviewVerdict | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  return (
    <section className={styles.section} aria-labelledby="review-title">
      <h2 id="review-title">Specialist review</h2>
      <p className={styles.meta}>
        Mark whether each shortlisted resource is the right kind of lead. This records a checkpoint
        for evaluation. It does not contact anyone and it does not recommend a treatment.
      </p>
      <div className={styles.reviewer}>
        <label htmlFor="reviewer-name">Reviewer name</label>
        <input
          id="reviewer-name"
          value={reviewer}
          autoComplete="name"
          onChange={(event) => setReviewer(event.target.value)}
        />
      </div>
      {resources.length === 0 ? (
        <p className={styles.empty}>
          No stored candidates to review for this case yet.{" "}
          <a href={`/cases/${caseId}/shortlist`}>Open the shortlist</a> and preview an order first.
        </p>
      ) : (
        resources.map((resource) => {
          const verdict = verdicts[resource.id] ?? "";
          return (
            <form
              className={styles.card}
              key={resource.id}
              onSubmit={(event) => {
                event.preventDefault();
                if (verdict !== "correct" && verdict !== "incorrect") {
                  setError("Choose correct or incorrect before saving a review.");
                  return;
                }
                if (!reviewer.trim()) {
                  setError("Enter the reviewer name before saving.");
                  return;
                }
                setError(null);
                setPending(resource.id);
                const note = notes[resource.id]?.trim();
                void onSubmit({
                  caseId,
                  reviewer: reviewer.trim(),
                  targetKind: resource.targetKind,
                  targetId: resource.targetId,
                  verdict,
                  note: note ? note : undefined,
                })
                  .then(() => setSaved((current) => ({ ...current, [resource.id]: true })))
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : "Could not save the review.");
                  })
                  .finally(() => setPending(null));
              }}
            >
              <h3>{resource.label}</h3>
              <p className={styles.meta}>
                {KIND_LABEL[resource.targetKind] ?? resource.targetKind}
                {resource.rank != null ? ` · rank ${resource.rank}` : ""}
                {resource.score != null ? ` · score ${resource.score}` : ""}
              </p>
              <div className={styles.choice}>
                <input
                  id={`${resource.id}-correct`}
                  type="radio"
                  name={`verdict-${resource.id}`}
                  checked={verdict === "correct"}
                  onChange={() => setVerdicts((current) => ({ ...current, [resource.id]: "correct" }))}
                />
                <label htmlFor={`${resource.id}-correct`}>Correct lead</label>
              </div>
              <div className={styles.choice}>
                <input
                  id={`${resource.id}-incorrect`}
                  type="radio"
                  name={`verdict-${resource.id}`}
                  checked={verdict === "incorrect"}
                  onChange={() => setVerdicts((current) => ({ ...current, [resource.id]: "incorrect" }))}
                />
                <label htmlFor={`${resource.id}-incorrect`}>Incorrect lead</label>
              </div>
              <div className={styles.note}>
                <label htmlFor={`${resource.id}-note`}>Note (optional)</label>
                <textarea
                  id={`${resource.id}-note`}
                  rows={2}
                  value={notes[resource.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [resource.id]: event.target.value }))
                  }
                />
              </div>
              <button type="submit" disabled={pending === resource.id}>
                {saved[resource.id] ? "Saved" : pending === resource.id ? "Saving…" : "Save review"}
              </button>
            </form>
          );
        })
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {agreement.length > 0 ? (
        <>
          <h3>Agreement by resource kind</h3>
          <ul className={styles.summary}>
            {agreement.map((row) => (
              <li key={row.targetKind}>
                {KIND_LABEL[row.targetKind] ?? row.targetKind}: {row.correct} correct, {row.incorrect}{" "}
                incorrect ({Math.round(row.agreementRate * 100)}% agreement)
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
