"use client";

import type { NeedsJudgeResult } from "@/components/judge/client";
import { JudgePanel } from "@/components/judge/JudgePanel";
import { NeedsProfile } from "@/components/judge/NeedsProfile";
import { Details, Skeleton } from "@/components/ui";
import { CASE_SECTION_HEADING, CASE_SUB_HEADING } from "@/components/outreach/CasePage";

/** True when there is anything to show in the "How the judge decided" pane. */
export function hasOverview(summary: string | null, result: NeedsJudgeResult | null): boolean {
  if (summary) return true;
  if (!result) return true; // still loading: keep the pinned row so the pane does not jump
  return result.ok && Boolean(result.needs || result.judge);
}

/**
 * Detail pane for the pinned "How the judge decided" row: the curator's read, the needs profile (one Details) and the
 * final judge's verdicts with "Why not?" for each dropped candidate. Data and guardrails come from components/judge
 * unchanged; this is layout only.
 */
export function JudgeOverview({ summary, result }: { summary: string | null; result: NeedsJudgeResult | null }) {
  const Heading = CASE_SECTION_HEADING;
  return (
    <section aria-labelledby="judge-overview-heading" className="grid min-w-0 gap-6">
      <header className="grid gap-2">
        <Heading
          id="judge-overview-heading"
          className="m-0 font-display text-h3 font-normal text-ink display-soft text-balance"
        >
          How the judge decided
        </Heading>
        {summary ? <p className="m-0 max-w-prose break-words text-body text-ink text-pretty">{summary}</p> : null}
      </header>
      {!result ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">Loading what the condition needs</span>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : result.ok ? (
        <>
          {result.needs ? (
            <Details summary="what the condition needs">
              <NeedsProfile needs={result.needs} headingAs={null} blockAs={CASE_SUB_HEADING} />
            </Details>
          ) : null}
          {result.judge ? <JudgePanel judge={result.judge} needs={result.needs} headingAs={CASE_SUB_HEADING} /> : null}
        </>
      ) : (
        <p className="m-0 text-small text-ink-2">The judge&rsquo;s notes could not be loaded. The list is still in scored order.</p>
      )}
    </section>
  );
}
