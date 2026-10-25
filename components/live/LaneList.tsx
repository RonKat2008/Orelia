import { memo } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import type { ActivityLane } from "@/lib/activity/types";
import { CHANNEL_ICON, CHANNEL_LABEL } from "./icons";
import { countdownLabel, relativeTime, stateLabel, stateTone } from "./format";
import { LiveCallPanel } from "./LiveCallPanel";

interface LaneListProps {
  lanes: ActivityLane[];
  selected: string | null;
  onSelect: (contactId: string | null) => void;
  /** Server-aligned "now" in ms; ticks every second. */
  nowMs: number;
}

function LaneRow({ lane, active, onSelect, nowMs }: { lane: ActivityLane; active: boolean; onSelect: () => void; nowMs: number }) {
  const Icon = CHANNEL_ICON[lane.channel];
  const countdown = countdownLabel(lane.nextFollowUpAt, nowMs);
  return (
    <li className={cn("grid gap-1.5 border-b border-line px-2 py-1.5 last:border-b-0", active && "bg-teal-soft")}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className="grid w-full min-w-0 gap-0.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon aria-label={CHANNEL_LABEL[lane.channel]} role="img" className="size-4 shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 truncate text-small font-semibold text-ink">{lane.resourceName}</span>
          <Badge tone={stateTone(lane.state)} dot>{stateLabel(lane.state)}</Badge>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-small text-ink-2">
          <span className="min-w-0 truncate">{lane.destinationLabel || CHANNEL_LABEL[lane.channel]}</span>
          <span className="tabular-nums">{relativeTime(lane.lastActivityAt, nowMs)}</span>
        </span>
        {countdown ? <span className="text-small tabular-nums text-ink-2">{countdown}</span> : null}
      </button>
      {lane.call ? <LiveCallPanel call={lane.call} /> : null}
      {lane.application ? (
        <p className="m-0 break-words text-small text-ink-2">
          Form: {stateLabel(lane.application.status)}
          {lane.application.confirmation ? ` · ${lane.application.confirmation}` : ""}
        </p>
      ) : null}
    </li>
  );
}

const MemoRow = memo(LaneRow);

export function LaneList({ lanes, selected, onSelect, nowMs }: LaneListProps) {
  if (lanes.length === 0) {
    return <p className="m-0 p-2 text-small text-ink-2">No outreach contacts yet. They appear here as soon as outreach is planned.</p>;
  }
  return (
    <ul aria-label="Outreach lanes" className="m-0 list-none rounded-md border border-line bg-card p-0">
      {lanes.map((lane) => (
        <MemoRow key={lane.contactId} lane={lane} active={selected === lane.contactId} onSelect={() => onSelect(selected === lane.contactId ? null : lane.contactId)} nowMs={nowMs} />
      ))}
    </ul>
  );
}
