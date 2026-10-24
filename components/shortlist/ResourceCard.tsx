"use client";

import type { Resource } from "@/lib/contracts";
import { EvidenceReveal } from "@/components/motion/EvidenceReveal";
import { ScoreBar } from "@/components/motion/ScoreBar";
import { evidenceForReason, type ShortlistCard } from "./data";
import { EvidenceList } from "./EvidenceList";

const MAX_SELECTED = 5;

function titleOf(resource: Resource): string {
  if (resource.kind === "trial") return resource.title;
  return resource.name;
}

const KIND_LABEL: Record<string, string> = {
  cancer_center: "Cancer center",
  rare_disease_center: "Rare disease center",
  hospital: "Hospital",
  advocacy: "Advocacy organization",
  financial_aid: "Financial aid",
  travel_aid: "Travel aid",
};

function humanize(value: string | undefined): string | undefined {
  return value ? (KIND_LABEL[value] ?? value) : undefined;
}

function detailOf(resource: Resource): string {
  if (resource.kind === "expert") {
    return [resource.credentials, resource.specialty].filter(Boolean).join(", ");
  }
  if (resource.kind === "institution") {
    const place = [resource.city, resource.state].filter(Boolean).join(", ");
    return [humanize(resource.institutionKind), place].filter(Boolean).join(" in ");
  }
  if (resource.kind === "trial") return [resource.nctId, resource.status].filter(Boolean).join(", ");
  return humanize(resource.organizationKind) ?? "Organization";
}

export function ResourceCard({
  card,
  selected,
  atCap,
  onToggle,
  scoreScale,
}: {
  card: ShortlistCard;
  /** Shared bar scale (the top score in the list) so bars compare across cards. */
  scoreScale?: number;
  selected: boolean;
  atCap: boolean;
  onToggle: (id: string) => void;
}) {
  const id = card.resource.id;
  const disabled = !selected && atCap;
  return (
    <article className="panel resource-card" data-selected={selected ? "true" : "false"}>
      <header className="resource-card__head">
        <h3>{titleOf(card.resource)}</h3>
        <p className="meta">{detailOf(card.resource)}</p>
      </header>
      {card.tier === "best" ? <p className="eyebrow">Best fit</p> : null}
      {card.tier === "exclude" ? <p className="eyebrow">Not a fit</p> : null}
      {card.tierReasons && card.tierReasons.length > 0 ? (
        <ul className="tier-reasons">
          {card.tierReasons.map((reason) => {
            const cited = evidenceForReason(card, reason.evidenceIds);
            return (
              <li key={reason.text}>
                <p>{reason.text}</p>
                {cited.length > 0 ? (
                  <>
                    <p className="meta">
                      {cited.map((item) => (
                        <a key={item.id} href={`#evidence-${item.id}`}>
                          Source: {item.claim}
                        </a>
                      ))}
                    </p>
                    <EvidenceList items={cited} />
                  </>
                ) : (
                  <p className="meta">This reason has no attached source, so it is not shown as a claim.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <ScoreBar items={card.breakdown} total={card.score} max={scoreScale} />
      <div className="resource-card__actions">
        <label className="check">
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={() => onToggle(id)}
          />
          <span>{selected ? "Selected to contact" : "Select to contact"}</span>
        </label>
        {disabled ? <p className="meta">Five resources are already selected. Uncheck one to add another.</p> : null}
      </div>
      {card.evidence.length > 0 ? (
        <EvidenceReveal evidence={card.evidence} />
      ) : (
        <p className="meta">No source links were attached to this result.</p>
      )}
    </article>
  );
}

export function selectionLimit() {
  return MAX_SELECTED;
}
