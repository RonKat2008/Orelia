"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StaggerList } from "@/components/motion/StaggerList";
import { WaypointRoute } from "@/components/motion/WaypointRoute";
import { ResourceCard, selectionLimit } from "./ResourceCard";
import { loadShortlist, type ShortlistCard } from "./data";

const GROUPS: { id: ShortlistCard["group"]; title: string; short: string }[] = [
  { id: "specialists", title: "Specialists and centers", short: "Specialists" },
  { id: "trials", title: "Trials", short: "Trials" },
  { id: "advocacy", title: "Advocacy", short: "Advocacy" },
  { id: "aid", title: "Aid", short: "Aid" },
];

export function ShortlistView({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<ShortlistCard[]>([]);
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const limit = selectionLimit();

  useEffect(() => {
    let active = true;
    const stored = sessionStorage.getItem(`wayfinder.selected.${caseId}`);
    void loadShortlist(caseId).then((result) => {
      if (!active) return;
      setItems(result.items);
      setPreview(result.preview);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          setSelected(parsed.slice(0, limit));
        }
      } catch {
        setSelected([]);
      }
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
      {GROUPS.map((group) => {
        const cards = items.filter((item) => item.group === group.id);
        if (cards.length === 0) return null;
        return (
          <section key={group.id} className="stack" aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`}>{group.title}</h2>
            <StaggerList
              as="ol"
              items={cards}
              getKey={(card) => card.resource.id}
              aria-label={`${group.title}, ranked`}
              renderItem={(card) => (
                <ResourceCard
                  card={card}
                  selected={selected.includes(card.resource.id)}
                  atCap={selected.length >= limit}
                  onToggle={toggle}
                />
              )}
            />
          </section>
        );
      })}
      <Link className="secondary button" href={`/cases/${caseId}/swarm`}>
        Back to the swarm
      </Link>
    </div>
  );
}
