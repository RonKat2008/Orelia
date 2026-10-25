"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsJudgeView } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { LaneList } from "./LaneList";
import { Timeline } from "./Timeline";
import { isTranscriptTurn } from "./format";
import { useActivityFeed, type FeedMode } from "./useActivityFeed";

/** Fade/slide only for newly arrived rows, and only when the viewer has not asked for reduced motion. */
const CSS = `
@media (prefers-reduced-motion: no-preference) {
  .live-new { animation: live-new 2.4s ease-out 1; }
  .live-pulse { animation: live-pulse 1.4s ease-in-out infinite; }
}
@keyframes live-new { from { background-color: var(--color-teal-soft); opacity: 0.2; } 60% { background-color: var(--color-teal-soft); opacity: 1; } to { background-color: transparent; } }
@keyframes live-pulse { 50% { opacity: 0.35; } }
`;

const MODE_TEXT: Record<FeedMode, string> = { connecting: "Connecting…", live: "Live", polling: "Live (refreshing every 3 s)" };

function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded-pill border px-2.5 py-0.5 text-small focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        active ? "border-teal bg-teal-soft font-semibold text-ink" : "border-line-strong bg-paper-2 text-ink-2",
      )}
    >
      {children}
    </button>
  );
}

/** The judge console: lane list (top on mobile, left on desktop) beside a live timeline. */
export function LiveConsole({ caseId, browserCall = false }: { caseId: string; browserCall?: boolean }) {
  const judge = useIsJudgeView();
  const { snapshot, mode, skewMs, freshIds } = useActivityFeed(caseId, judge);
  const clientNow = useNowMs();
  const nowMs = clientNow + skewMs;
  const [selected, setSelected] = useState<string | null>(null);
  const [showTurns, setShowTurns] = useState(false);

  const laneNames = useMemo(() => new Map((snapshot?.lanes ?? []).map((l) => [l.contactId, l.resourceName])), [snapshot]);
  const visible = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.events
      .filter((e) => (selected === null ? true : e.contactId === selected))
      .filter((e) => showTurns || !isTranscriptTurn(e))
      .reverse();
  }, [snapshot, selected, showTurns]);

  return (
    <div className="grid min-w-0 gap-3">
      <style>{CSS}</style>
      <p role="status" className="m-0 flex items-center gap-2 text-small text-ink-2">
        <span aria-hidden className={cn("size-2 rounded-pill", mode === "live" ? "live-pulse bg-ok" : mode === "polling" ? "bg-warn" : "bg-line-strong")} />
        {MODE_TEXT[mode]}
      </p>
      {!snapshot ? (
        <p className="m-0 text-small text-ink-2">Loading activity…</p>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section aria-labelledby="live-lanes-heading" className="grid min-w-0 gap-1.5">
            <h2 id="live-lanes-heading" className="m-0 text-body font-semibold text-ink">Contacts ({snapshot.lanes.length})</h2>
            <LaneList lanes={snapshot.lanes} selected={selected} onSelect={setSelected} nowMs={nowMs} browserCall={browserCall} />
          </section>
          <section aria-labelledby="live-timeline-heading" className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 id="live-timeline-heading" className="m-0 mr-1 text-body font-semibold text-ink">Timeline</h2>
              <Chip active={selected === null} onClick={() => setSelected(null)}>All</Chip>
              {selected ? <Chip active onClick={() => setSelected(null)}>{laneNames.get(selected) ?? "Contact"} ✕</Chip> : null}
              <Chip active={showTurns} onClick={() => setShowTurns((v) => !v)}>Transcript lines</Chip>
            </div>
            <Timeline events={visible} laneNames={laneNames} freshIds={freshIds} />
          </section>
        </div>
      )}
    </div>
  );
}
