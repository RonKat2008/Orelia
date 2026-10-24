"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RANKING_WEIGHTS, type RankingWeights } from "@/config/ranking";
import {
  ReviewCheckpoint,
  type ReviewResource,
  type ReviewSubmit,
} from "@/components/ranking/ReviewCheckpoint";
import { WeightsPanel } from "@/components/ranking/WeightsPanel";
import type { AgreementSummary } from "@/components/ranking/model";
import { CasePage } from "@/components/outreach/CasePage";
import { normalizeShortlist } from "@/components/shortlist/data";
import { titleOf } from "@/components/shortlist/view-model";
import { Button, Details, JudgeOnly, LoadingState, Skeleton } from "@/components/ui";
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";

const SectionH = CASE_SECTION_HEADING;

interface PreviewRow {
  id: string;
  targetKind: string;
  targetId: string;
  rank: number;
  score: number;
  breakdown: { text: string }[];
}

type Names = Record<string, string>;

interface Saved {
  names: Names;
  /** The saved shortlist as review rows, used when the weights preview cannot run. */
  rows: ReviewResource[];
}

async function fetchSaved(caseId: string): Promise<Saved> {
  try {
    const response = await fetch(`/api/cases/${caseId}/shortlist`);
    if (!response.ok) return { names: {}, rows: [] };
    const payload = normalizeShortlist(await response.json());
    const cards = payload?.items ?? [];
    return {
      names: Object.fromEntries(
        cards.map((card) => [card.resource.id, titleOf(card.resource)]),
      ),
      rows: cards.map((card, index) => ({
        id: card.resource.id,
        targetKind: card.resource.kind,
        targetId: card.resource.id,
        rank: index + 1,
        score: card.score,
        label: titleOf(card.resource),
      })),
    };
  } catch {
    return { names: {}, rows: [] };
  }
}

async function fetchPreview(
  caseId: string,
  weights: RankingWeights,
  names: Names,
): Promise<ReviewResource[]> {
  const response = await fetch("/api/ranking/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, weights }),
  });
  const payload = (await response.json()) as {
    error?: string;
    candidates?: PreviewRow[];
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Preview ranking is unavailable.");
  return (payload.candidates ?? []).map((row) => ({
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    rank: row.rank,
    score: row.score,
    label:
      names[row.targetId] ??
      row.breakdown.find(
        (item) => item.text && item.text !== "No verified evidence available",
      )?.text ??
      row.targetId,
  }));
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const [weights, setWeights] = useState<RankingWeights>({
    ...RANKING_WEIGHTS,
  });
  const [resources, setResources] = useState<ReviewResource[]>([]);
  const [saved, setSaved] = useState<Saved>({ names: {}, rows: [] });
  const [fallback, setFallback] = useState(false);
  const [agreement, setAgreement] = useState<AgreementSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const rerank = useCallback(
    async (next: RankingWeights, known: Saved) => {
      try {
        setResources(await fetchPreview(caseId, next, known.names));
        setStatus(null);
        setFallback(false);
      } catch (cause) {
        // Without the preview service, review the saved order so the checkpoint still works.
        if (known.rows.length > 0) {
          setResources((current) =>
            current.length > 0 ? current : known.rows,
          );
          setFallback(true);
          setStatus(null);
        } else {
          setStatus(
            cause instanceof Error
              ? cause.message
              : "Preview ranking is unavailable.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [caseId],
  );

  useEffect(() => {
    let active = true;
    void fetchSaved(caseId).then(async (found) => {
      if (!active) return;
      setSaved(found);
      await rerank(RANKING_WEIGHTS, found);
    });
    return () => {
      active = false;
    };
  }, [caseId, rerank]);

  function changeWeights(next: RankingWeights) {
    setWeights(next);
    setBusy(true);
    void rerank(next, saved);
  }

  async function saveReview(review: ReviewSubmit) {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(review),
    });
    const payload = (await response.json()) as {
      error?: string;
      agreement?: AgreementSummary[];
    };
    if (!response.ok)
      throw new Error(payload.error ?? "Could not save the review.");
    setAgreement(payload.agreement ?? []);
  }

  return (
    // LANE C SWITCH POINT: patient={<Patient… />}
    <CasePage
      eyebrow="Evaluator tool"
      title="Check the shortlist"
      lede="Mark each lead correct or incorrect. Changing the order only previews it and never replaces the saved shortlist."
      action={
        <Button asChild variant="link" className="min-h-11">
          <Link href={`/cases/${caseId}/shortlist`}>Back to the shortlist</Link>
        </Button>
      }
    >
      <JudgeOnly>
        <Details summary="Tune the order" className="max-w-prose">
          <WeightsPanel weights={weights} onChange={changeWeights} />
        </Details>
      </JudgeOnly>
      <div className="min-w-0" aria-busy={busy}>
        {busy && resources.length === 0 ? (
          <LoadingState label="Previewing this order">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-56 w-full rounded-lg" />
          </LoadingState>
        ) : status ? (
          <div role="alert" className="grid gap-3">
            <SectionH className="m-0 font-display text-h3 font-normal text-ink text-balance">Preview ranking is unavailable</SectionH>
            <p className="m-0 text-body text-danger">{status}</p>
            <div>
              <Button
                onClick={() => {
                  setBusy(true);
                  void rerank(weights, saved);
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <>
            {fallback ? (
              <p className="mb-6 mt-0 text-small text-ink-2">
                The weights preview is unavailable right now, so this is the saved order. Reviews still save.
              </p>
            ) : null}
            <ReviewCheckpoint caseId={caseId} resources={resources} agreement={agreement} onSubmit={saveReview} />
          </>
        )}
      </div>
    </CasePage>
  );
}
