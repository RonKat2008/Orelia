"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { SwarmConstellation } from "@/components/motion/swarm/SwarmConstellation";
import { CasePage } from "@/components/outreach/CasePage";
import {
  Badge,
  Button,
  Details,
  List,
  Progress,
  Separator,
  Stepper,
  TwoPane,
  WIDE_QUERY,
  toast,
  useMediaQuery,
} from "@/components/ui";
import type { AgentName } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AGENT_LABEL, type SwarmAgent } from "@/lib/motion/status";
import { AgentDetail, AgentRow, STILL_WAITING_MS } from "./AgentCard";
import { SourceStrip, SourcesRow } from "./SourceStrip";
import {
  PHASES,
  activePhaseTimer,
  connectionBadge,
  derivePhase,
  describeProgress,
  formatElapsed,
  isSettled,
  narrate,
  needsLine,
  swarmTotals,
  type AgentCardState,
  type PhaseIndex,
  type PhaseRuns,
} from "./stream";
import { useSwarmStream } from "./useSwarmStream";

function toSwarmAgents(cards: AgentCardState[]): SwarmAgent[] {
  return cards.map((card) => ({
    name: card.agent,
    status: card.status,
    counts: card.counts ? { records: card.counts.records ?? 0, sources: card.counts.evidence ?? 0 } : undefined,
  }));
}

function ConnectionNote({ connection, caseStatus }: { connection: string; caseStatus?: string }) {
  if (connection === "preview") {
    return (
      <p className="m-0 rounded-md border border-gold bg-gold-soft px-4 py-3 text-small text-ink">
        Showing a typed preview. The live stream connects when the research service is running.
      </p>
    );
  }
  if (connection === "polling" && caseStatus !== "ready" && caseStatus !== "research_failed") {
    return <Badge tone="warn" dot>Still working — reconnecting</Badge>;
  }
  const badge = connectionBadge(connection, caseStatus);
  return (
    <Badge tone={badge.tone} dot={badge.dot}>
      {badge.label}
    </Badge>
  );
}

/** "Ranking what fits… 0:34 · usually about a minute" while the post-search stages run. */
function PhaseTimerLine({ label, startedAtMs, clockOffsetMs, detail }: { label: string; startedAtMs: number | null; clockOffsetMs: number; detail?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = startedAtMs === null ? null : formatElapsed(now + clockOffsetMs - startedAtMs);
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-small text-ink-2" data-testid="phase-timer">
      <span>
        {label}…{elapsed ? <span className="ml-2 font-semibold tabular-nums text-ink">{elapsed}</span> : null}
      </span>
      {detail ? <span className="font-semibold text-ink" data-testid="phase-progress">{detail}</span> : null}
      <span>Finishing up usually takes about a minute.</span>
    </p>
  );
}

const NEEDS_TONE: Record<string, string> = {
  waiting: "bg-ink-3/40",
  running: "bg-teal animate-pulse motion-reduce:animate-none",
  done: "bg-ok",
  unavailable: "bg-ink-3/40",
};

const NEEDS_WORD: Record<string, string> = { done: "done", running: "in progress", waiting: "waiting", unavailable: "skipped" };

/** "Understanding your condition": runs alongside the searches, with a timer while running and its summary after. */
function NeedsPhaseLine({ phases, clockOffsetMs }: { phases: PhaseRuns; clockOffsetMs: number }) {
  const line = needsLine(phases);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (line.state !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [line.state]);
  const elapsed =
    line.state === "running" && line.startedAtMs !== null
      ? formatElapsed(now + clockOffsetMs - line.startedAtMs)
      : line.state === "done" && line.startedAtMs !== null && line.finishedAtMs !== null
        ? formatElapsed(line.finishedAtMs - line.startedAtMs)
        : null;
  return (
    <div className="grid gap-1" data-testid="needs-phase" data-state={line.state}>
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-small font-semibold text-ink">
        <span aria-hidden="true" className={`inline-block size-2 rounded-full ${NEEDS_TONE[line.state]}`} />
        <span>{line.label}</span>
        <span className="font-normal text-ink-2">· {NEEDS_WORD[line.state]}</span>
        {elapsed ? <span className="ml-auto font-semibold tabular-nums text-ink">{elapsed}</span> : null}
      </p>
      {line.detail ? <p className="m-0 text-small text-ink-2 [overflow-wrap:anywhere]">{line.detail}</p> : null}
    </div>
  );
}

/** Mounted only while an agent is queued; unmounting (status change or page leave) clears the timer. */
function StillWaitingTimer({ agent, onStale }: { agent: AgentName; onStale: (agent: AgentName) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onStale(agent), STILL_WAITING_MS);
    return () => window.clearTimeout(timer);
  }, [agent, onStale]);
  return null;
}

/** Presentational only: which queued agents have had no change for 60 s. Never touches the stream. */
function useStillWaiting(cards: AgentCardState[]) {
  const queuedKey = cards
    .filter((card) => card.status === "queued")
    .map((card) => card.agent)
    .join(" ");
  const [stale, setStale] = useState<ReadonlySet<AgentName>>(() => new Set());
  const [prevKey, setPrevKey] = useState(queuedKey);
  if (prevKey !== queuedKey) {
    setPrevKey(queuedKey);
    const queued = new Set(queuedKey.split(" "));
    setStale((prev) => new Set([...prev].filter((agent) => queued.has(agent))));
  }
  const markStale = useCallback((agent: AgentName) => setStale((prev) => new Set(prev).add(agent)), []);
  const timers = queuedKey
    ? (queuedKey.split(" ") as AgentName[]).map((agent) => <StillWaitingTimer key={agent} agent={agent} onStale={markStale} />)
    : null;
  return { stale, timers };
}

type Selection = AgentName | "sources" | null;

function RunOverview({
  cards,
  connection,
  caseStatus,
  narration,
  timer,
  clockOffsetMs,
  phases,
  phase,
  done,
  total,
  records,
  evidence,
  ready,
}: {
  cards: AgentCardState[];
  connection: string;
  caseStatus?: string;
  narration: string;
  timer: ReturnType<typeof activePhaseTimer>;
  clockOffsetMs: number;
  phases: PhaseRuns;
  phase: PhaseIndex;
  done: number;
  total: number;
  records: number;
  evidence: number;
  ready: boolean;
}) {
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-xs xl:max-w-none">
        <SwarmConstellation agents={toSwarmAgents(cards)} announce={false} showLegend={false} caseLabel="Your case" />
      </div>
      <div className="grid min-w-0 gap-5">
        <div className="grid justify-items-start gap-2">
          <ConnectionNote connection={connection} caseStatus={caseStatus} />
          <p className="m-0 text-body font-semibold text-ink text-pretty">{narration}</p>
          {timer ? <PhaseTimerLine label={timer.label} startedAtMs={timer.startedAtMs} clockOffsetMs={clockOffsetMs} detail={timer.detail} /> : null}
        </div>
        <Progress label="Searches finished" valueText={`${done} of ${total}`} value={done} max={total} tone={ready ? "ok" : "teal"} />
        <p className="m-0 text-small text-ink-2 tabular-nums">
          {records} {records === 1 ? "record" : "records"} kept · {evidence} {evidence === 1 ? "source" : "sources"}
        </p>
        <NeedsPhaseLine phases={phases} clockOffsetMs={clockOffsetMs} />
        <Stepper
          orientation="vertical"
          aria-label="Research phases"
          steps={PHASES.map((p) => ({ id: p.id, label: p.label, description: p.description }))}
          current={phase}
        />
      </div>
    </div>
  );
}

export function SwarmView({ caseId }: { caseId: string }) {
  const reduced = useReducedMotionGate();
  const swarm = useSwarmStream(caseId);
  const { cards, caseStatus, connection, lastActive, sources, retry, retrying, retryError, phases, clockOffsetMs } = swarm;
  const wide = useMediaQuery(WIDE_QUERY, true);
  const { stale, timers } = useStillWaiting(cards);
  const [selected, setSelected] = useState<Selection>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [prevCards, setPrevCards] = useState(cards);
  const [announcement, setAnnouncement] = useState("");
  if (prevCards !== cards) {
    const next = describeProgress(prevCards, cards);
    setPrevCards(cards);
    if (next) setAnnouncement(next);
  }

  const ready = caseStatus === "ready";
  const failed = caseStatus === "research_failed" || connection === "lost";
  const phase = failed ? 0 : derivePhase(cards, caseStatus, phases);
  const timer = failed ? null : activePhaseTimer(cards, caseStatus, phases);
  const totals = swarmTotals(cards);
  const preview = connection === "preview";

  // "Not available yet" searches leave the list and the counts; they are named under "Coming later".
  const available = cards.filter((card) => card.status !== "not_implemented");
  const comingLater = cards.filter((card) => card.status === "not_implemented");
  const done = available.filter((card) => isSettled(card.status)).length;
  const total = available.length;

  useEffect(() => {
    if (ready) toast.success("Research finished", { description: "Your shortlist is ready to review." });
  }, [ready]);

  const [readyNote, setReadyNote] = useState(false);
  if (ready && !readyNote) {
    setReadyNote(true);
    setAnnouncement("Research finished. Your shortlist is ready to review.");
  }

  const select = (next: Selection) => {
    setSelected(next);
    setDetailOpen(true);
  };

  const shortlistHref = `/cases/${caseId}/shortlist`;
  const action = ready ? (
    <Button asChild>
      <Link href={shortlistHref}>
        Review the shortlist
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  ) : undefined;

  const judgeLede = ready
    ? `${totals.records} records kept, each with a source link; nothing is sent until you approve it.`
    : "Each search runs at the same time, and every record keeps its source link.";

  const selectedCard = selected && selected !== "sources" ? cards.find((card) => card.agent === selected) : undefined;
  const withSources = (card: AgentCardState): AgentCardState => ({
    ...card,
    sources: sources.filter((s) => "agent" in s && s.agent === card.agent),
  });
  const selectedDetail =
    selected === "sources" ? (
      <SourceStrip sources={sources} preview={preview} showTitle={wide} />
    ) : selectedCard ? (
      <AgentDetail card={withSources(selectedCard)} stillWaiting={stale.has(selectedCard.agent)} showTitle={wide} />
    ) : null;
  const detailTitle = selected === "sources" ? `Sources (${sources.length})` : selectedCard ? AGENT_LABEL[selectedCard.agent] : undefined;

  const overview = (
    <RunOverview
      cards={cards}
      connection={connection}
      caseStatus={caseStatus}
      narration={narrate(cards, caseStatus, lastActive, phases)}
      timer={timer}
      clockOffsetMs={clockOffsetMs}
      phases={phases}
      phase={phase}
      done={done}
      total={total}
      records={totals.records}
      evidence={totals.evidence}
      ready={ready}
    />
  );

  const agentList = (
    <div className="grid gap-4">
      <List label="Searches">
        {available.map((card) => (
          <AgentRow
            key={card.agent}
            card={card}
            stillWaiting={stale.has(card.agent)}
            selected={selected === card.agent}
            onSelect={() => select(card.agent)}
          />
        ))}
        <SourcesRow count={sources.length} preview={preview} selected={selected === "sources"} onSelect={() => select("sources")} />
      </List>
      {comingLater.length > 0 ? (
        <Details label={null} summary={`Coming later (${comingLater.length})`}>
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {comingLater.map((card) => (
              <li key={card.agent}>{AGENT_LABEL[card.agent]}</li>
            ))}
          </ul>
          <p className="m-0 text-small">These searches are not part of the first release.</p>
        </Details>
      ) : null}
    </div>
  );

  return (
    <CasePage
      width="judge"
      title="Agent swarm"
      lede={judgeLede}
      action={action}
    >
      <div className="grid min-w-0 gap-8" aria-busy={!ready && !failed}>
        {timers}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <AnimatePresence>
          {failed ? (
            <motion.div
              key="failed"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.25 }}
              role="alert"
              className="grid gap-3 rounded-lg border border-danger/35 bg-danger-soft p-5"
            >
              <p className="m-0 flex items-center gap-2 text-body font-semibold text-ink">
                <TriangleAlert aria-hidden className="size-4 text-danger" />
                The search did not finish
              </p>
              <p className="m-0 max-w-prose text-body text-ink-2">Nothing was lost. You can start the search again with the same details.</p>
              <div>
                <Button onClick={() => void retry()} loading={retrying} loadingText="Restarting">
                  <RefreshCw aria-hidden />
                  Try the search again
                </Button>
                {retryError ? <p className="m-0 mt-3 text-small text-danger" role="alert">{retryError}</p> : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {wide ? null : overview}
          <TwoPane
            listLabel="Searches"
            detailLabel="Run detail"
            list={agentList}
            detail={
              wide ? (
                <div className="grid min-w-0 gap-6">
                  {overview}
                  {selectedDetail ? (
                    <>
                      <Separator />
                      {selectedDetail}
                    </>
                  ) : (
                    <p className="m-0 text-small text-ink-2">Select a search to see what it kept and its sources.</p>
                  )}
                </div>
              ) : (
                selectedDetail
              )
            }
            detailOpen={detailOpen}
            onDetailOpenChange={setDetailOpen}
            detailTitle={detailTitle}
          />
      </div>
    </CasePage>
  );
}
