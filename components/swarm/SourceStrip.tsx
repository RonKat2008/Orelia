"use client";

import { Link2 } from "lucide-react";
import { ListRow, SourceChip } from "@/components/ui";
import type { SourceRef } from "./stream";
import { CASE_SECTION_HEADING } from "@/components/outreach/CasePage";

const SectionH = CASE_SECTION_HEADING;

/** The single "Sources (N)" row in the judge list; opens the full list in the detail pane. */
export function SourcesRow({
  count,
  preview,
  selected,
  onSelect,
}: {
  count: number;
  preview: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListRow
      title={`Sources (${count})`}
      leading={<Link2 aria-hidden className="size-4 text-ink-3" />}
      meta={
        preview
          ? "Example links, not real findings"
          : count === 0
            ? "Links appear as searches finish"
            : "Every record keeps its source link"
      }
      selected={selected}
      onSelect={onSelect}
    />
  );
}

/** Every source the swarm has linked so far, shown in the detail pane (or the Sheet below 1024 px). */
export function SourceStrip({ sources, preview, showTitle = true }: { sources: SourceRef[]; preview: boolean; showTitle?: boolean }) {
  return (
    <div className="grid min-w-0 gap-3">
      {showTitle ? <SectionH className="m-0 text-h3 font-semibold text-ink">Sources ({sources.length})</SectionH> : null}
      {preview ? <p className="m-0 text-small text-ink-2">Example links, not real findings.</p> : null}
      {sources.length === 0 ? (
        <p className="m-0 text-body text-ink-2">
          Links appear here as searches finish. A claim without a source link never reaches the shortlist.
        </p>
      ) : (
        <ul aria-label="Sources found so far" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sources.map((source) => (
            <li key={source.url} className="min-w-0 max-w-full">
              <SourceChip url={source.url} title={source.title} verified={source.verified} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
