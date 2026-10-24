"use client";

import { DoorClosed, DoorOpen, MapPin, Sparkles } from "lucide-react";
import { Badge, Checkbox, ChoiceRow, SourceChip } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { evidenceForReason, type ShortlistCard } from "./data";
import { EvidenceList } from "./EvidenceList";
import { ScoreStack } from "./ScoreStack";
import {
  contactDoorOf,
  eyebrowOf,
  placeOf,
  tierLabel,
  titleOf,
} from "./view-model";

const MAX_SELECTED = 5;

export function selectionLimit() {
  return MAX_SELECTED;
}

export type CardVariant = "feature" | "standard" | "muted";

export function ResourceCard({
  card,
  variant = "standard",
  selected,
  atCap,
  onToggle,
  scoreScale,
}: {
  card: ShortlistCard;
  variant?: CardVariant;
  /** Shared bar scale (the top score in the list) so bars compare across cards. */
  scoreScale?: number;
  selected: boolean;
  atCap: boolean;
  onToggle: (id: string) => void;
}) {
  const id = card.resource.id;
  const disabled = !selected && atCap;
  const title = titleOf(card.resource);
  const place = placeOf(card.resource);
  const door = contactDoorOf(card);
  const tier = tierLabel(card.tier);
  const reasons = (card.tierReasons ?? []).flatMap((reason) => {
    const cited = evidenceForReason(card, reason.evidenceIds);
    // A reason with no source behind it is a claim we cannot show, so it is left out.
    return cited.length > 0 ? [{ text: reason.text, cited }] : [];
  });
  const feature = variant === "feature";

  return (
    <article
      data-selected={selected}
      aria-label={title}
      className={cn(
        "relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 rounded-lg border bg-card p-5 text-ink sm:p-7",
        "transition-[box-shadow,border-color,background-color] duration-300 ease-out-expo motion-reduce:transition-none",
        feature
          ? "border-line/70 shadow-md lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10"
          : "border-line shadow-xs",
        variant === "muted" && "bg-paper-2/50",
        selected &&
          "border-teal/60 bg-teal-soft/30 shadow-md ring-1 ring-teal/30",
      )}
    >
      {feature ? (
        <span
          aria-hidden
          className="absolute inset-y-6 left-0 w-1 rounded-r-pill bg-terracotta"
        />
      ) : null}

      <div className="grid min-w-0 content-start gap-5">
        <header className="grid gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="m-0 text-micro font-semibold uppercase text-ink-3">
              {eyebrowOf(card.resource)}
            </p>
            {tier ? (
              <Badge
                tone={
                  card.tier === "best"
                    ? "teal"
                    : card.tier === "exclude"
                      ? "neutral"
                      : "sage"
                }
              >
                {card.tier === "best" ? <Sparkles aria-hidden /> : null}
                {tier}
              </Badge>
            ) : null}
          </div>
          <h4 className="m-0 max-w-none font-display text-h3 font-normal text-ink display-soft text-balance">
            {title}
          </h4>
          {place ? (
            <p className="m-0 flex items-center gap-1.5 text-small text-ink-2">
              <MapPin aria-hidden className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 break-words">{place}</span>
            </p>
          ) : null}
        </header>

        {reasons.length > 0 ? (
          <section aria-label="Why it fits" className="grid gap-3">
            <h5 className="m-0 text-micro font-semibold uppercase text-ink-3">
              {card.tier === "exclude" ? "Why it was set aside" : "Why it fits"}
            </h5>
            <ul className="m-0 grid list-none gap-4 p-0">
              {reasons.map((reason) => (
                <li key={reason.text} className="grid gap-2">
                  <p className="m-0 max-w-prose text-body text-pretty">
                    {reason.text}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {reason.cited.map((item) => (
                      <SourceChip
                        key={item.id ?? item.sourceUrl}
                        url={item.sourceUrl}
                        verified
                        date={item.fetchedAt}
                        title={item.claim}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <details className="group/sources rounded-md border border-line bg-card open:bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 text-small font-semibold text-ink focus-ring [&::-webkit-details-marker]:hidden">
            <span>
              Sources{" "}
              <span className="font-normal text-ink-3">
                ({card.evidence.length})
              </span>
            </span>
            <span
              aria-hidden
              className="text-ink-3 transition-transform duration-300 group-open/sources:rotate-45 motion-reduce:transition-none"
            >
              +
            </span>
          </summary>
          <div className="px-4 pb-4">
            <EvidenceList items={card.evidence} />
          </div>
        </details>
      </div>

      <div className="grid min-w-0 content-start gap-5">
        <ScoreStack card={card} scale={scoreScale} />

        <p
          className={cn(
            "m-0 flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-small",
            door.found
              ? "border-ok/30 bg-ok-soft/60 text-ink"
              : "border-dashed border-line-strong bg-paper-2/60 text-ink-2",
          )}
        >
          {door.found ? (
            <DoorOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
          ) : (
            <DoorClosed
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-ink-3"
            />
          )}
          <span className="min-w-0">
            <strong className="block font-semibold">
              {door.found ? "Contact door found" : "No contact door found yet"}
            </strong>
            <span className="text-pretty">
              {door.text ||
                "Wayfinder found no public office, intake line or form for this one."}
            </span>
          </span>
        </p>

        <ChoiceRow
          title={selected ? "Selected to contact" : "Select to contact"}
          description={
            disabled
              ? "Five are already chosen. Remove one to add this."
              : "Nothing is sent until you approve it."
          }
          className={cn(disabled && "opacity-60")}
        >
          <Checkbox
            checked={selected}
            disabled={disabled}
            onCheckedChange={() => onToggle(id)}
            aria-label={`Select ${title} to contact`}
          />
        </ChoiceRow>
      </div>
    </article>
  );
}
