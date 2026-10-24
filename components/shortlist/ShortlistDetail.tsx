"use client";

import type { JudgeResult } from "@/lib/contracts/judge";
import { Badge, CheckedMark, Details } from "@/components/ui";
import { verdictFor } from "@/components/judge/match";
import { verdictLabel } from "@/components/judge/view-model";
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";
import { evidenceForReason, type ShortlistCard } from "./data";
import { EvidenceList } from "./EvidenceList";
import { ScoreStack } from "./ScoreStack";
import { VerifiedBadges } from "./VerifiedBadges";
import { VerifyByPhone } from "./VerifyByPhone";
import { canVerifyByPhone, resourceKeyOf, type BadgeView } from "./verify-model";
import { contactDoorOf, eyebrowOf, placeOf, tierLabel, titleOf } from "./view-model";

export const TIER_TONE: Record<NonNullable<ShortlistCard["tier"]>, "teal" | "neutral" | "outline"> = {
  best: "teal",
  good: "neutral",
  backup: "outline",
  exclude: "outline",
};

const MAX_REASONS = 3;

export interface ShortlistDetailProps {
  card: ShortlistCard;
  caseId: string;
  judge: JudgeResult | null;
  scoreScale: number | undefined;
  insurer: string | null;
  badges: BadgeView[];
  onVerificationChanged: () => void;
  /** The pane's action ("Add to contacts"); on phones the Sheet footer carries it instead. */
  action?: React.ReactNode;
  /** Hide the visible title (the Sheet header already shows the name). */
  hideTitle?: boolean;
}

/** Judge detail pane for one shortlist entry (docs/DESIGN-v2.md 7.6): the read, then Score, Sources, Contact route. */
export function ShortlistDetail({
  card,
  caseId,
  judge,
  scoreScale,
  insurer,
  badges,
  onVerificationChanged,
  action,
  hideTitle = false,
}: ShortlistDetailProps) {
  const Heading = CASE_SECTION_HEADING;
  const title = titleOf(card.resource);
  const place = placeOf(card.resource);
  const tier = tierLabel(card.tier);
  const door = contactDoorOf(card);
  const verdict = verdictFor(judge, {
    kind: card.resource.kind,
    name: card.resource.kind === "trial" ? undefined : card.resource.name,
    title: card.resource.kind === "trial" ? card.resource.title : undefined,
    nctId: card.resource.kind === "trial" ? card.resource.nctId : undefined,
    npi: card.resource.kind === "expert" ? card.resource.npi : undefined,
  });
  const reasons = (card.tierReasons ?? [])
    .flatMap((reason) => {
      const cited = evidenceForReason(card, reason.evidenceIds);
      // A reason with no source behind it is a claim we cannot show, so it is left out.
      return cited.length > 0 ? [{ text: reason.text, sources: cited.length }] : [];
    })
    .slice(0, MAX_REASONS);
  const total = Math.round(card.score);

  return (
    <article aria-label={title} className="grid min-w-0 gap-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          {hideTitle ? null : (
            <Heading className="m-0 min-w-0 break-words font-display text-h3 font-normal text-ink display-soft text-balance">
              {title}
            </Heading>
          )}
          <span className="flex shrink-0 flex-wrap gap-2">
            {tier && card.tier ? <Badge tone={TIER_TONE[card.tier]}>{tier}</Badge> : null}
            {verdict ? <Badge tone="outline">Judge: {verdictLabel(verdict.verdict)}</Badge> : null}
          </span>
        </div>
        <p className="m-0 break-words text-small text-ink-2">{[eyebrowOf(card.resource), place].filter(Boolean).join(" · ")}</p>
      </header>

      {reasons.length > 0 || verdict ? (
        <section aria-label="Why it fits" className="grid gap-3">
          {reasons.map((reason) => (
            <p key={reason.text} className="m-0 max-w-prose text-body text-ink text-pretty">
              {reason.text} <CheckedMark sources={reason.sources} className="align-baseline" />
            </p>
          ))}
          {verdict ? (
            <p className="m-0 max-w-prose break-words text-small text-ink-2">
              <span className="font-semibold text-ink">Final judge: </span>
              {verdict.verdict === "drop" ? verdict.plain : verdict.reason}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-1 border-t border-line pt-3">
        <Details summary={`Score ${total}`} label={null}>
          <ScoreStack card={card} scale={scoreScale} />
        </Details>
        <Details summary={`Sources (${card.evidence.length})`} label={null}>
          <EvidenceList items={card.evidence} />
        </Details>
        <Details summary="Contact route" label={null}>
          <p className="m-0 text-small text-ink">
            <span className="font-semibold">{door.found ? "Contact found. " : "No contact found yet. "}</span>
            {door.text || "Wayfinder found no public office, intake line or form for this one."}
          </p>
          <VerifiedBadges caseId={caseId} badges={badges} />
        </Details>
      </div>

      {action || canVerifyByPhone(card) ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {action}
          {canVerifyByPhone(card) ? (
            <VerifyByPhone
              caseId={caseId}
              resourceKey={resourceKeyOf(card)}
              name={title}
              insurer={insurer}
              onChanged={onVerificationChanged}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
