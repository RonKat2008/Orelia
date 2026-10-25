import { memo } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import type { ActivityLane } from "@/lib/activity/types";
import { CHANNEL_ICON, CHANNEL_LABEL } from "./icons";
import { isVapiStartError } from "@/lib/channels/vapi-limits";
import { countdownLabel, relativeTime, stateLabel, stateTone } from "./format";
import { LiveCallPanel } from "./LiveCallPanel";
import { BrowserCallButton } from "./BrowserCallButton";
import { useHasBrowserCall } from "./browser-call-store";

interface LaneListProps {
  lanes: ActivityLane[];
  selected: string | null;
  onSelect: (contactId: string | null) => void;
  /** Server-aligned "now" in ms; ticks every second. */
  nowMs: number;
  /** DEMO ONLY: offer "Take the call in your browser" on drafted call lanes (server decides; it re-checks). */
  browserCall?: boolean;
}

/** A call lane still waiting for approval (first call), with no call in progress. */
export const canTakeInBrowser = (lane: Pick<ActivityLane, "channel" | "state" | "call">): boolean =>
  lane.channel === "voice" && lane.state === "drafted" && !lane.call?.live;

function LaneRow({ lane, active, onSelect, nowMs, browserCall }: { lane: ActivityLane; active: boolean; onSelect: () => void; nowMs: number; browserCall?: boolean }) {
  const Icon = CHANNEL_ICON[lane.channel];
  // Once a browser call starts the lane leaves 'drafted'; its session (outside React) keeps the widget on screen.
  const startedHere = useHasBrowserCall(lane.contactId);
  const showBrowserCall = browserCall === true && (startedHere || canTakeInBrowser(lane));
  const countdown = countdownLabel(lane.nextFollowUpAt, nowMs);
  return (
    <li className={cn("grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0", active && "bg-teal-soft")}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className="flex w-full min-w-0 flex-col items-stretch gap-0.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
      >
        <span className="flex w-full min-w-0 items-center justify-start gap-2">
          <span className="sr-only">{CHANNEL_LABEL[lane.channel]}: </span>
          <span className="min-w-0 flex-1 truncate text-left text-small font-semibold text-ink">{lane.resourceName}</span>
          <Badge tone={stateTone(lane.state)} dot className="shrink-0">{stateLabel(lane.state)}</Badge>
        </span>
        <span className="flex w-full min-w-0 items-center justify-start gap-x-2 text-left text-small text-ink-2">
          <span className="min-w-0 truncate">{lane.destinationLabel || CHANNEL_LABEL[lane.channel]}</span>
          <span aria-hidden className="text-ink-3">·</span>
          <span className="shrink-0 tabular-nums">{relativeTime(lane.lastActivityAt, nowMs)}</span>
        </span>
        {countdown ? <span className="w-full text-left text-small tabular-nums text-ink-2">{countdown}</span> : null}
      </button>
      {lane.call || showBrowserCall || lane.application ? (
        <div className="col-start-2 grid min-w-0 gap-1.5">
          {lane.call ? <LiveCallPanel call={lane.call} /> : null}
          {showBrowserCall ? <BrowserCallButton compact contactId={lane.contactId} phoneFailed={isVapiStartError(lane.call?.endedReason ?? lane.call?.outcome)} /> : null}
          {lane.application ? (
            <p className="m-0 break-words text-small text-ink-2">
              Form: {stateLabel(lane.application.status)}
              {lane.application.confirmation ? ` · ${lane.application.confirmation}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const MemoRow = memo(LaneRow);

export function LaneList({ lanes, selected, onSelect, nowMs, browserCall }: LaneListProps) {
  if (lanes.length === 0) {
    return <p className="m-0 p-2 text-small text-ink-2">No outreach contacts yet. They appear here as soon as outreach is planned.</p>;
  }
  return (
    <ul aria-label="Outreach lanes" className="m-0 list-none rounded-md border border-line bg-card p-0">
      {lanes.map((lane) => (
        <MemoRow key={lane.contactId} lane={lane} active={selected === lane.contactId} onSelect={() => onSelect(selected === lane.contactId ? null : lane.contactId)} nowMs={nowMs} browserCall={browserCall} />
      ))}
    </ul>
  );
}
