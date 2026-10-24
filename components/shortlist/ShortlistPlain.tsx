"use client";

import { useState } from "react";
import Link from "next/link";
import type { JudgeResult } from "@/lib/contracts/judge";
import { plainSentenceFor } from "@/components/judge/match";
import { Badge, Button, CheckedMark, Checkbox, Details, List, ListRow } from "@/components/ui";
import { selectionKey, type ShortlistCard } from "./data";
import { eyebrowOf, placeOf, titleOf } from "./view-model";

/** Suggested rows shown before "Show N more" (docs/DESIGN-v2.md 7.6). */
const FIRST_ROWS = 3;

function whyThisOne(card: ShortlistCard, judge: JudgeResult | null): string | null {
  const plain = plainSentenceFor(judge, {
    kind: card.resource.kind,
    name: card.resource.kind === "trial" ? undefined : card.resource.name,
    title: card.resource.kind === "trial" ? card.resource.title : undefined,
    nctId: card.resource.kind === "trial" ? card.resource.nctId : undefined,
    npi: card.resource.kind === "expert" ? card.resource.npi : undefined,
  });
  return plain ?? card.tierReasons?.[0]?.text ?? null;
}

export interface ShortlistPlainProps {
  caseId: string;
  items: ShortlistCard[];
  suggested: string[];
  selected: string[];
  limit: number;
  judge: JudgeResult | null;
  onToggle: (id: string) => void;
}

/**
 * Plain shortlist for patient view: suggested first, one meta line, at most one badge, one "Why this one?" each, and
 * one in-flow button. No scores, tiers, filters, tuning or phone checks. Lane C may replace this with its own
 * component through the CasePage `patient` switch point.
 */
export function ShortlistPlain({ caseId, items, suggested, selected, limit, judge, onToggle }: ShortlistPlainProps) {
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = items.filter((card) => card.tier !== "exclude");
  const picked = new Set(suggested);
  const ordered = [...shown.filter((card) => picked.has(selectionKey(card))), ...shown.filter((card) => !picked.has(selectionKey(card)))];
  const first = Math.max(FIRST_ROWS, Math.min(suggested.length, limit));
  const rows = showAll ? ordered : ordered.slice(0, first);
  const hidden = ordered.length - rows.length;
  const count = selected.length;

  return (
    <div className="grid max-w-patient gap-6">
      {error ? (
        <p role="alert" className="m-0 text-body font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <List label="People who may help">
        {rows.map((card) => {
          const key = selectionKey(card);
          const id = `pick-${key}`;
          const isOn = selected.includes(key);
          const why = whyThisOne(card, judge);
          const title = titleOf(card.resource);
          return (
            <ListRow
              key={key}
              title={title}
              selectId={id}
              meta={[eyebrowOf(card.resource), placeOf(card.resource)].filter(Boolean).join(" · ")}
              badges={card.tier === "best" ? <Badge tone="teal">Good match</Badge> : null}
              leading={
                <Checkbox
                  id={id}
                  checked={isOn}
                  disabled={!isOn && count >= limit}
                  onCheckedChange={() => {
                    setError(null);
                    onToggle(key);
                  }}
                />
              }
            >
              {why ? (
                <Details summary="Why this one?" label={null}>
                  <p className="m-0">{why}</p>
                  {card.evidence.length > 0 ? <CheckedMark sources={card.evidence.length} /> : null}
                </Details>
              ) : null}
            </ListRow>
          );
        })}
      </List>
      {hidden > 0 ? (
        <Button variant="link" className="justify-self-start" onClick={() => setShowAll(true)}>
          Show {hidden} more
        </Button>
      ) : null}
      <div className="grid justify-items-start gap-3">
        {count > 0 ? (
          <Button asChild size="lg">
            <Link href={`/cases/${caseId}/consent`}>Continue with {count} chosen</Link>
          </Button>
        ) : (
          <Button size="lg" onClick={() => setError("Choose at least one place to contact, or come back later.")}>
            Continue with 0 chosen
          </Button>
        )}
        <p className="m-0 text-small text-ink-2">You can pick up to {limit}. Nothing is sent without your OK.</p>
      </div>
    </div>
  );
}
