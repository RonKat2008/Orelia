"use client";

import { CircleCheck, CircleDashed, Clock, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AgentRunStatus } from "@/lib/contracts";
import { Badge, ListRow, SourceChip, type BadgeProps } from "@/components/ui";
import { AGENT_LABEL, STATUS_PRESENTATION } from "@/lib/motion/status";
import { cn } from "@/lib/ui/cn";
import { NARRATIVE, type AgentCardState } from "./stream";

/** A queued search with no change for this long reads "Still waiting" (presentational only). */
export const STILL_WAITING_MS = 60_000;

const ICONS: Record<AgentRunStatus, LucideIcon> = {
  queued: Clock,
  running: LoaderCircle,
  done: CircleCheck,
  failed: TriangleAlert,
  not_implemented: CircleDashed,
};

const BADGE_TONE: Record<AgentRunStatus, NonNullable<BadgeProps["tone"]>> = {
  queued: "neutral",
  running: "teal",
  done: "ok",
  failed: "danger",
  not_implemented: "outline",
};

const ICON_TONE: Record<AgentRunStatus, string> = {
  queued: "text-ink-3",
  running: "text-teal-ink dark:text-teal",
  done: "text-ok",
  failed: "text-danger",
  not_implemented: "text-ink-3",
};

export const countsLine = (card: AgentCardState): { records: number; sources: number } | null => {
  const records = card.counts?.records;
  const sources = card.counts?.evidence;
  if (records === undefined && sources === undefined) return null;
  return { records: records ?? 0, sources: sources ?? 0 };
};

/** "Waiting" / "Still waiting" for queued searches; the shared status words otherwise. */
export function statusWord(status: AgentRunStatus, stillWaiting = false): string {
  if (status === "queued") return stillWaiting ? "Still waiting" : "Waiting";
  return STATUS_PRESENTATION[status].label;
}

function countsText(card: AgentCardState): string | null {
  const counts = countsLine(card);
  if (!counts) return null;
  return `${counts.records} ${counts.records === 1 ? "record" : "records"} kept · ${counts.sources} ${counts.sources === 1 ? "source" : "sources"}`;
}

function StatusIcon({ status }: { status: AgentRunStatus }) {
  const Icon = ICONS[status];
  return (
    <Icon
      aria-hidden
      className={cn("size-4", ICON_TONE[status], status === "running" && "animate-spin motion-reduce:animate-none")}
    />
  );
}

/** One search in the judge list: name, one status word, and what it has kept so far. */
export function AgentRow({
  card,
  stillWaiting,
  selected,
  onSelect,
}: {
  card: AgentCardState;
  stillWaiting: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { status } = card;
  const meta =
    countsText(card) ??
    (status === "running" ? `${NARRATIVE[card.agent]}…` : status === "queued" ? "Waiting for a turn" : null);
  return (
    <ListRow
      data-status={status}
      title={AGENT_LABEL[card.agent]}
      leading={<StatusIcon status={status} />}
      badges={
        <Badge tone={BADGE_TONE[status]} size="sm">
          {statusWord(status, stillWaiting)}
        </Badge>
      }
      meta={meta}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

/** The selected search in the detail pane (or the Sheet below 1024 px). */
export function AgentDetail({
  card,
  stillWaiting,
  showTitle = true,
}: {
  card: AgentCardState;
  stillWaiting: boolean;
  /** Off inside the Sheet, whose title already names the search. */
  showTitle?: boolean;
}) {
  const { status } = card;
  const counts = countsText(card);
  const sources = card.sources ?? [];
  return (
    <div className="grid min-w-0 gap-4" data-status={status}>
      {showTitle ? <h3 className="m-0 text-h3 font-semibold text-ink">{AGENT_LABEL[card.agent]}</h3> : null}
      <p className="m-0 flex items-center gap-2 text-body text-ink">
        <StatusIcon status={status} />
        <span>{statusWord(status, stillWaiting)}</span>
      </p>
      {status === "running" ? <p className="m-0 text-body text-ink-2">{NARRATIVE[card.agent]}…</p> : null}
      {status === "queued" ? <p className="m-0 text-body text-ink-2">Waiting for a turn.</p> : null}
      {counts ? <p className="m-0 text-body text-ink-2 tabular-nums">{counts}</p> : null}
      {card.error ? (
        <p className="m-0 rounded-md bg-danger-soft px-3 py-2 text-small text-ink">
          This search hit a problem. The others carry on.
        </p>
      ) : null}
      {sources.length > 0 ? (
        <ul aria-label={`Sources from ${AGENT_LABEL[card.agent]}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sources.map((source) => (
            <li key={source.url} className="min-w-0 max-w-full">
              <SourceChip url={source.url} title={source.title} verified={source.verified} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
