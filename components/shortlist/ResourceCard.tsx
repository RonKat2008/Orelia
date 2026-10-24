"use client";

import { useState } from "react";
import type { Resource, ScoreBreakdownItem } from "@/lib/contracts";
import { EvidenceList } from "./EvidenceList";
import type { ShortlistCard } from "./data";

const MAX_SELECTED = 5;

function titleOf(resource: Resource): string {
  if (resource.kind === "trial") return resource.title;
  return resource.name;
}

function detailOf(resource: Resource): string {
  if (resource.kind === "expert") {
    return [resource.credentials, resource.specialty].filter(Boolean).join(" · ");
  }
  if (resource.kind === "institution") {
    return [resource.city, resource.state, resource.institutionKind].filter(Boolean).join(" · ");
  }
  if (resource.kind === "trial") return [resource.nctId, resource.status].filter(Boolean).join(" · ");
  return resource.organizationKind ?? "Organization";
}

function Breakdown({ items }: { items: ScoreBreakdownItem[] }) {
  return (
    <ul className="evidence">
      {items.map((item) => (
        <li key={item.factor + item.text}>
          {item.text} <span className="meta">({item.points})</span>
        </li>
      ))}
    </ul>
  );
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
  const [open, setOpen] = useState(false);
  const id = card.resource.id;
  const disabled = !selected && atCap;
  return (
    <article className="panel stack">
      <div className="card-head">
        <h3>{titleOf(card.resource)}</h3>
        <span className="status done">{card.score}</span>
      </div>
      <p className="meta">{detailOf(card.resource)}</p>
      <Breakdown items={card.breakdown} />
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
      <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Hide sources" : "Show sources"}
      </button>
      {open ? <EvidenceList items={card.evidence} /> : null}
    </article>
  );
}

export function selectionLimit() {
  return MAX_SELECTED;
}
