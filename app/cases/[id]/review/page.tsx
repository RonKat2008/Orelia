"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RANKING_WEIGHTS, type RankingWeights } from "@/config/ranking";
import { ReviewCheckpoint, type ReviewResource, type ReviewSubmit } from "@/components/ranking/ReviewCheckpoint";
import { WeightsPanel } from "@/components/ranking/WeightsPanel";
import type { AgreementSummary } from "@/components/ranking/model";

interface PreviewRow {
  id: string;
  targetKind: string;
  targetId: string;
  rank: number;
  score: number;
  breakdown: { text: string }[];
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const [weights, setWeights] = useState<RankingWeights>({ ...RANKING_WEIGHTS });
  const [resources, setResources] = useState<ReviewResource[]>([]);
  const [agreement, setAgreement] = useState<AgreementSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function rerank(next: RankingWeights) {
    setWeights(next);
    const response = await fetch("/api/ranking/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, weights: next }),
    });
    const payload = (await response.json()) as { error?: string; candidates?: PreviewRow[] };
    if (!response.ok) {
      setStatus(payload.error ?? "Preview ranking is unavailable.");
      return;
    }
    setStatus(null);
    setResources(
      (payload.candidates ?? []).map((row) => ({
        id: row.id,
        targetKind: row.targetKind,
        targetId: row.targetId,
        rank: row.rank,
        score: row.score,
        label: row.breakdown.find((item) => item.text && item.text !== "No verified evidence available")?.text ?? row.targetId,
      })),
    );
  }

  async function saveReview(review: ReviewSubmit) {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(review),
    });
    const payload = (await response.json()) as { error?: string; agreement?: AgreementSummary[] };
    if (!response.ok) throw new Error(payload.error ?? "Could not save the review.");
    setAgreement(payload.agreement ?? []);
  }

  return (
    <main className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">Review</p>
      </header>
      <h1>Check the shortlist</h1>
      <p className="lede">
        Adjust how resources are ordered, then mark each lead correct or incorrect. Changing weights
        previews a new order and does not replace the saved shortlist.{" "}
        <Link href={`/cases/${caseId}/shortlist`}>Back to the shortlist</Link>.
      </p>
      <WeightsPanel weights={weights} onChange={(next) => void rerank(next)} />
      <p>
        <button type="button" onClick={() => void rerank(weights)}>
          Preview this order
        </button>
      </p>
      {status ? <p role="status">{status}</p> : null}
      <ReviewCheckpoint caseId={caseId} resources={resources} agreement={agreement} onSubmit={saveReview} />
    </main>
  );
}
