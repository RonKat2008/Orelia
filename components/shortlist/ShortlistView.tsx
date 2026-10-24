"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StaggerList } from "@/components/motion/StaggerList";
import { WaypointRoute } from "@/components/motion/WaypointRoute";
import { ResourceCard, selectionLimit } from "./ResourceCard";
import { bandShortlist, initialSelection, loadShortlist, type ShortlistCard } from "./data";

function readStoredSelection(caseId: string): string[] | null {
  const stored = sessionStorage.getItem(`wayfinder.selected.${caseId}`);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    return null;
  }
  return null;
}

function CardList({
  cards,
  label,
  selected,
  limit,
  onToggle,
  scoreScale,
}: {
  cards: ShortlistCard[];
  label: string;
  selected: string[];
  limit: number;
  onToggle: (id: string) => void;
  scoreScale: number | undefined;
}) {
  return (
    <StaggerList
      as="ol"
      items={cards}
      getKey={(card) => card.resource.id}
      aria-label={label}
      renderItem={(card) => (
        <ResourceCard
          card={card}
          selected={selected.includes(card.resource.id)}
          atCap={selected.length >= limit}
          onToggle={onToggle}
          scoreScale={scoreScale}
        />
      )}
    />
  );
}

const GROUPS: { id: ShortlistCard["group"]; title: string; short: string }[] = [
  { id: "specialists", title: "Specialists and centers", short: "Specialists" },
  { id: "trials", title: "Trials", short: "Trials" },
  { id: "advocacy", title: "Advocacy", short: "Advocacy" },
  { id: "aid", title: "Aid", short: "Aid" },
];

export function ShortlistView({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<ShortlistCard[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const limit = selectionLimit();

  useEffect(() => {
    let active = true;
    const stored = readStoredSelection(caseId);
    void loadShortlist(caseId).then((result) => {
      if (!active) return;
      setItems(result.payload.items);
      setSummary(result.payload.curationSummary);
      setPreview(result.preview);
      setSelected(initialSelection(stored, result.payload.suggested, limit));
    });
    return () => {
      active = false;
    };
  }, [caseId, limit]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= limit
          ? current
          : [...current, id];
      sessionStorage.setItem(`wayfinder.selected.${caseId}`, JSON.stringify(next));
      return next;
    });
  }

  const scoreScale = items.reduce((top, item) => Math.max(top, item.score), 0) || undefined;
  const presentGroups = GROUPS.filter((group) => items.some((item) => item.group === group.id));
  const waypoints = presentGroups.map((group) => ({
    id: group.id,
    label: group.short,
    count: items.filter((item) => item.group === group.id).length,
  }));

  return (
    <div className="stack">
      {waypoints.length > 0 ? (
        <WaypointRoute
          waypoints={waypoints}
          label={`Your shortlist covers ${waypoints.length} kinds of help`}
        />
      ) : null}
      <p className="notice">
        {preview
          ? "Preview shortlist with source links. Live ranking replaces it when the research service answers."
          : "Ranked from the sources Wayfinder could verify."}{" "}
        Choose up to {limit}. {selected.length} selected.
      </p>
      {summary ? <p className="notice">{summary}</p> : null}
      {GROUPS.map((group) => {
        const cards = items.filter((item) => item.group === group.id);
        if (cards.length === 0) return null;
        const bands = bandShortlist(cards);
        return (
          <section key={group.id} className="stack" aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`}>{group.title}</h2>
            {bands.curated && bands.best.length > 0 ? (
              <div className="stack">
                <h3>Best fit</h3>
                <CardList
                  cards={bands.best}
                  label={`Best fit ${group.title}`}
                  selected={selected}
                  limit={limit}
                  onToggle={toggle}
                  scoreScale={scoreScale}
                />
              </div>
            ) : null}
            {bands.listed.length > 0 ? (
              <CardList
                cards={bands.listed}
                label={bands.curated ? `Other ${group.title}` : `${group.title}, ranked`}
                selected={selected}
                limit={limit}
                onToggle={toggle}
                scoreScale={scoreScale}
              />
            ) : null}
            {bands.excluded.length > 0 ? (
              <details>
                <summary>Not a fit ({bands.excluded.length})</summary>
                <CardList
                  cards={bands.excluded}
                  label={`Not a fit, ${group.title}`}
                  selected={selected}
                  limit={limit}
                  onToggle={toggle}
                  scoreScale={scoreScale}
                />
              </details>
            ) : null}
          </section>
        );
      })}
      <Link className="secondary button" href={`/cases/${caseId}/swarm`}>
        Back to the swarm
      </Link>
    </div>
  );
}
