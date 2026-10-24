"use client";

import type { Resource } from "@/lib/contracts";
import { EvidenceReveal } from "@/components/motion/EvidenceReveal";
import { ScoreBar } from "@/components/motion/ScoreBar";
import type { ShortlistCard } from "./data";

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
}: {
  card: ShortlistCard;
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
      <ScoreBar items={card.breakdown} total={card.score} />
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
