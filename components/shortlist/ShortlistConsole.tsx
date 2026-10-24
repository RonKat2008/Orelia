"use client";

import { useMemo, useState } from "react";
import { Gavel } from "lucide-react";
import type { VerificationsResponse } from "@/lib/verification/contract";
import type { NeedsJudgeResult } from "@/components/judge/client";
import { Badge, Button, CheckedMark, Checkbox, EmptyState, List, ListRow, TwoPane, WIDE_QUERY, useMediaQuery } from "@/components/ui";
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";
import { bandShortlist, selectionKey, type ShortlistCard } from "./data";
import { FilterBar } from "./FilterBar";
import { JudgeOverview, hasOverview } from "./JudgeOverview";
import { ShortlistDetail, TIER_TONE } from "./ShortlistDetail";
import { badgeViews } from "./verify-model";
import { GROUPS, NO_FILTERS, eyebrowOf, matchesFilters, placeOf, tierLabel, titleOf, type ShortlistFilters } from "./view-model";

const OVERVIEW = "__overview__";

export interface ShortlistConsoleProps {
  caseId: string;
  items: ShortlistCard[];
  filters: ShortlistFilters;
  homeState: string | null;
  onFiltersChange: (next: ShortlistFilters) => void;
  selected: string[];
  limit: number;
  onToggle: (id: string) => void;
  summary: string | null;
  judgeResult: NeedsJudgeResult | null;
  verifications: VerificationsResponse | null;
  insurer: string | null;
  onVerificationChanged: () => void;
}

interface Group {
  id: string;
  title: string;
  cards: ShortlistCard[];
}

/** Visible cards per kind, best and listed first, "Not a fit" last (same banding as before, as rows). */
function groupRows(visible: ShortlistCard[]): Group[] {
  const groups: Group[] = [];
  const excluded: ShortlistCard[] = [];
  for (const group of GROUPS) {
    const bands = bandShortlist(visible.filter((card) => card.group === group.id));
    const cards = [...bands.best, ...bands.listed];
    if (cards.length > 0) groups.push({ id: group.id, title: group.title, cards });
    excluded.push(...bands.excluded);
  }
  if (excluded.length > 0) groups.push({ id: "excluded", title: "Not a fit", cards: excluded });
  return groups;
}

/**
 * Judge shortlist console (docs/DESIGN-v2.md 7.6): TwoPane with a pinned "How the judge decided" row and one row per
 * candidate (name, tier badge, type · place, ✓ Checked), and the selected item's detail on the right.
 */
export function ShortlistConsole({
  caseId,
  items,
  filters,
  homeState,
  onFiltersChange,
  selected,
  limit,
  onToggle,
  summary,
  judgeResult,
  verifications,
  insurer,
  onVerificationChanged,
}: ShortlistConsoleProps) {
  const GroupHeading = CASE_SECTION_HEADING;
  const showOverview = hasOverview(summary, judgeResult);
  const visible = useMemo(() => items.filter((card) => matchesFilters(card, filters, homeState)), [items, filters, homeState]);
  const groups = useMemo(() => groupRows(visible), [visible]);
  const counts = useMemo(
    () => Object.fromEntries(GROUPS.map((group) => [group.id, items.filter((item) => item.group === group.id).length])),
    [items],
  );
  const scoreScale = items.reduce((top, item) => Math.max(top, item.score), 0) || undefined;
  const firstKey = groups[0]?.cards[0] ? selectionKey(groups[0].cards[0]) : null;

  const [chosenRow, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery(WIDE_QUERY, true);
  // Derived: fall back to the overview (or the first row) when nothing is picked or filters hide the picked row.
  const fallback = showOverview ? OVERVIEW : firstKey;
  const isValid =
    chosenRow !== null &&
    (chosenRow === OVERVIEW ? showOverview : visible.some((card) => selectionKey(card) === chosenRow));
  const active = isValid ? chosenRow : fallback;

  const select = (key: string) => {
    setActive(key);
    setOpen(true);
  };

  const activeCard = active && active !== OVERVIEW ? visible.find((card) => selectionKey(card) === active) : undefined;
  const judge = judgeResult?.ok ? judgeResult.judge : null;
  const counted = judge?.counts;

  const toggleButton = (card: ShortlistCard) => {
    const key = selectionKey(card);
    const isOn = selected.includes(key);
    const full = !isOn && selected.length >= limit;
    return (
      <Button variant="secondary" disabled={full} onClick={() => onToggle(key)}>
        {isOn ? "Remove from contacts" : full ? `${limit} already chosen` : "Add to contacts"}
      </Button>
    );
  };

  const detail =
    active === OVERVIEW ? (
      <JudgeOverview summary={summary} result={judgeResult} />
    ) : activeCard ? (
      <ShortlistDetail
        card={activeCard}
        caseId={caseId}
        judge={judge}
        scoreScale={scoreScale}
        insurer={insurer}
        badges={badgeViews(
          verifications?.badges[`${activeCard.resource.kind}:${activeCard.resource.id}`],
          verifications?.requests ?? [],
        )}
        onVerificationChanged={onVerificationChanged}
        action={wide ? toggleButton(activeCard) : undefined}
        hideTitle={!wide}
      />
    ) : null;

  const list = (
    <div className="grid gap-6">
      {showOverview ? (
        <List label="Judge">
          <ListRow
            title="How the judge decided"
            leading={<Gavel aria-hidden className="text-ink-2" />}
            meta={
              counted
                ? `Kept ${counted.keep} · Maybe ${counted.maybe} · Dropped ${counted.drop}`
                : "Needs profile and the curator's read"
            }
            onSelect={() => select(OVERVIEW)}
            selected={active === OVERVIEW}
          />
        </List>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          title="Nothing matches these filters"
          description="Try turning a filter off. Your choices so far are kept."
          action={
            <Button variant="link" onClick={() => onFiltersChange(NO_FILTERS)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.id} aria-labelledby={`sl-group-${group.id}`} className="grid gap-2">
            <GroupHeading id={`sl-group-${group.id}`} className="m-0 px-3 text-small font-semibold text-ink-2">
              {group.title} <span className="font-normal">({group.cards.length})</span>
            </GroupHeading>
            <List>
              {group.cards.map((card) => {
                const key = selectionKey(card);
                const title = titleOf(card.resource);
                const isOn = selected.includes(key);
                const tier = tierLabel(card.tier);
                return (
                  <ListRow
                    key={key}
                    title={title}
                    onSelect={() => select(key)}
                    selected={active === key}
                    leading={
                      <Checkbox
                        checked={isOn}
                        disabled={!isOn && selected.length >= limit}
                        onCheckedChange={() => onToggle(key)}
                        aria-label={`Choose ${title} to contact`}
                      />
                    }
                    badges={tier && card.tier ? <Badge tone={TIER_TONE[card.tier]}>{tier}</Badge> : null}
                    meta={
                      <>
                        {[eyebrowOf(card.resource), placeOf(card.resource)].filter(Boolean).join(" · ")}
                        {card.evidence.length > 0 ? (
                          <>
                            {" · "}
                            <CheckedMark />
                          </>
                        ) : null}
                      </>
                    }
                  />
                );
              })}
            </List>
          </section>
        ))
      )}
    </div>
  );

  return (
    <TwoPane
      listLabel="Shortlist"
      detailLabel="Selected item"
      listHeader={
        <FilterBar filters={filters} counts={counts} canFilterState={homeState !== null} onChange={onFiltersChange} />
      }
      list={list}
      detail={detail ? <div className="relative min-w-0 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">{detail}</div> : null}
      emptyDetail={<EmptyState title="Pick a row" description="Its sources, score and contact route show here." />}
      detailOpen={open}
      onDetailOpenChange={setOpen}
      detailTitle={activeCard ? titleOf(activeCard.resource) : "How the judge decided"}
      detailFooter={activeCard && !wide ? toggleButton(activeCard) : undefined}
    />
  );
}
