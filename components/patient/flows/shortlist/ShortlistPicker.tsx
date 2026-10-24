"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  BackLink,
  Badge,
  Button,
  CheckedMark,
  Checkbox,
  Details,
  EmptyState,
  List,
  ListRow,
  LoadingState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { selectionKey, type ShortlistCard } from "@/components/shortlist/data";
import { plainSentenceFor } from "@/components/judge/match";
import type { JudgeResult } from "@/lib/contracts/judge";
import { ActionError, ActionFrame } from "../../actions/ActionFrame";
import { SHORTLIST_COPY as COPY } from "./copy";
import { PICK_LIMIT, isGoodMatch, metaLine, nameOf, sourceCount, splitSuggested, suggestedCount, whyThisOne } from "./logic";
import { useShortlistPicker } from "./useShortlistPicker";

export interface ShortlistPickerProps {
  caseId: string;
  /** "card": inside the case home's ActionCard. "page": the shortlist sub-page. */
  layout: "card" | "page";
  titleAs?: "h1" | "h2";
  detailsHref?: string;
  /** After the picks are saved as contacts. */
  onDone: () => Promise<void> | void;
}

const KIND = "pick_contacts";

function PickRow({
  card,
  suggested,
  judge,
  on,
  disabled,
  onToggle,
}: {
  card: ShortlistCard;
  suggested: string[];
  judge: JudgeResult | null;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const key = selectionKey(card);
  const id = `pick-${key}`;
  const plain = plainSentenceFor(judge, card.resource as Parameters<typeof plainSentenceFor>[1]);
  const why = whyThisOne(card, plain);
  const sources = sourceCount(card);
  return (
    <ListRow
      data-picked={on ? "true" : "false"}
      title={nameOf(card)}
      meta={metaLine(card)}
      selectId={id}
      selected={on}
      badges={isGoodMatch(card, suggested) ? <Badge tone="teal">{COPY.goodMatch}</Badge> : undefined}
      maxBadges={1}
      leading={<Checkbox id={id} checked={on} disabled={disabled} onCheckedChange={onToggle} />}
    >
      {why || sources > 0 ? (
        <Details summary={COPY.why} label={null}>
          <p className="m-0 text-body text-ink-2">{why}</p>
          {sources > 0 ? <CheckedMark sources={sources} /> : null}
        </Details>
      ) : null}
    </ListRow>
  );
}

/**
 * Patient shortlist (docs/DESIGN-v2.md 7.6): the suggested rows with a checkbox, one meta line, at most one badge and
 * one "Why this one?"; "Show N more" expands once. No scores, tiers, filters or phone checks.
 */
export function ShortlistPicker({ caseId, layout, titleAs = "h1", detailsHref, onDone }: ShortlistPickerProps) {
  const picker = useShortlistPicker(caseId);
  const [expanded, setExpanded] = useState(false);
  const { loaded, selected } = picker;

  async function submit() {
    if (await picker.submit()) await onDone();
  }

  const lede = loaded && loaded.cards.length > 0 ? COPY.lede(loaded.cards.length, PICK_LIMIT, suggestedCount(loaded.cards, loaded.suggested)) : undefined;

  let content: ReactNode;
  let ready = false;
  if (!loaded) {
    content = (
      <LoadingState label={COPY.loading}>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-16 w-full" />
        ))}
      </LoadingState>
    );
  } else if (loaded.cards.length === 0) {
    content =
      layout === "card" ? (
        <ActionError messages={[loaded.error ?? COPY.emptyText]} />
      ) : (
        <EmptyState
          title={COPY.emptyTitle}
          description={loaded.error ?? COPY.emptyText}
          action={
            <Link href={`/cases/${caseId}`} className="rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring">
              {COPY.backToCase}
            </Link>
          }
        />
      );
  } else {
    ready = true;
    const { first, more } = splitSuggested(loaded.cards, loaded.suggested);
    const rows = expanded ? [...first, ...more] : first;
    const full = selected.length >= PICK_LIMIT;
    content = (
      <>
        <ActionError messages={picker.errors} />
        <List label={COPY.listLabel}>
          {rows.map((card) => {
            const key = selectionKey(card);
            const on = selected.includes(key);
            return (
              <PickRow
                key={key}
                card={card}
                suggested={loaded.suggested}
                judge={picker.judge}
                on={on}
                disabled={picker.busy || (!on && full)}
                onToggle={() => picker.toggle(key)}
              />
            );
          })}
        </List>
        <p role="status" className="m-0 text-small text-ink-2">
          {full ? COPY.full(PICK_LIMIT) : <span className="sr-only">{COPY.chosen(selected.length, PICK_LIMIT)}</span>}
        </p>
        {!expanded && more.length > 0 ? (
          <div>
            <Button type="button" variant="link" onClick={() => setExpanded(true)}>
              {COPY.showMore(more.length)}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  const action = ready ? (
    <Button size="lg" loading={picker.busy} loadingText={COPY.busy} onClick={() => void submit()}>
      {COPY.continue(selected.length)}
    </Button>
  ) : undefined;

  if (layout === "card") {
    return (
      <ActionFrame
        kind={KIND}
        title={COPY.title}
        lede={lede}
        detailsHref={detailsHref}
        action={action}
        reassurance={ready ? COPY.reassurance : undefined}
      >
        {content}
      </ActionFrame>
    );
  }

  return (
    <div className="grid max-w-patient gap-6">
      <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>
      <PageHeader as={titleAs} title={COPY.title} lede={lede} className="mb-0" />
      {content}
      {action ? (
        <div className="grid gap-3">
          <div>{action}</div>
          <p className="m-0 text-small text-ink-2">{COPY.reassurance}</p>
        </div>
      ) : null}
    </div>
  );
}
