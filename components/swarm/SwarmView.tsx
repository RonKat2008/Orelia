"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { SwarmConstellation } from "@/components/motion/swarm/SwarmConstellation";
import { Badge, Button, Progress, Stat, StatGroup, Stepper, Surface, toast } from "@/components/ui";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { SPRING } from "@/lib/ui/motion";
import type { SwarmAgent } from "@/lib/motion/status";
import { AgentCard } from "./AgentCard";
import { SourceStrip } from "./SourceStrip";
import { PHASES, activePhaseTimer, connectionBadge, derivePhase, describeProgress, formatElapsed, narrate, needsLine, swarmTotals, type AgentCardState, type PhaseRuns } from "./stream";
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
    <div className="grid gap-1 rounded-md border border-line bg-paper/70 px-4 py-3" data-testid="needs-phase" data-state={line.state}>
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-small font-semibold text-ink">
        <span aria-hidden="true" className={`inline-block size-2 rounded-full ${NEEDS_TONE[line.state]}`} />
        <span>{line.label}</span>
        <span className="font-normal text-ink-2">
          {line.state === "done" ? "· done" : line.state === "running" ? "· in progress" : line.state === "waiting" ? "· queued" : "· skipped"}
        </span>
        {elapsed ? <span className="ml-auto font-semibold tabular-nums text-ink">{elapsed}</span> : null}
      </p>
      {line.detail ? <p className="m-0 text-small text-ink-2 [overflow-wrap:anywhere]">{line.detail}</p> : null}
    </div>
  );
}

export function SwarmView({ caseId }: { caseId: string }) {
  const reduced = useReducedMotionGate();
  const swarm = useSwarmStream(caseId);
  const { cards, caseStatus, connection, lastActive, sources, retry, retrying, retryError, phases, clockOffsetMs } = swarm;

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

  useEffect(() => {
    if (ready) toast.success("Research finished", { description: "Your shortlist is ready to review." });
  }, [ready]);

  const [readyNote, setReadyNote] = useState(false);
  if (ready && !readyNote) {
    setReadyNote(true);
    setAnnouncement("Research finished. Your shortlist is ready to review.");
  }

  return (
    <div className="grid gap-10" aria-busy={!ready && !failed}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <Surface variant="raised" padding="lg" className="grain overflow-hidden">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <SwarmConstellation agents={toSwarmAgents(cards)} announce={false} showLegend={false} caseLabel="Your case" />
          <div className="grid gap-7">
            <div className="grid gap-3">
              <ConnectionNote connection={connection} caseStatus={caseStatus} />
              <p className="m-0 font-display text-h3 font-light text-ink display-soft text-balance">
                {narrate(cards, caseStatus, lastActive, phases)}
              </p>
              {timer ? <PhaseTimerLine label={timer.label} startedAtMs={timer.startedAtMs} clockOffsetMs={clockOffsetMs} detail={timer.detail} /> : null}
            </div>
            <NeedsPhaseLine phases={phases} clockOffsetMs={clockOffsetMs} />
            <Progress
              label="Searches finished"
              valueText={`${totals.settled} of ${totals.total}`}
              value={totals.settled}
              max={totals.total}
              tone={ready ? "ok" : "teal"}
            />
            <StatGroup>
              <Stat label="Records kept" value={totals.records} />
              <Stat label="Sources" value={totals.evidence} />
            </StatGroup>
            <Stepper
              orientation="vertical"
              aria-label="Research phases"
              steps={PHASES.map((p) => ({ id: p.id, label: p.label, description: p.description }))}
              current={phase}
            />
          </div>
        </div>
      </Surface>

      <AnimatePresence>
        {failed ? (
          <motion.div
            key="failed"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="grid gap-4 rounded-lg border border-danger/35 bg-danger-soft p-6"
          >
            <p className="m-0 flex items-center gap-2 text-h4 font-bold text-ink">
              <TriangleAlert aria-hidden className="size-5 text-danger" />
              The search did not finish
            </p>
            <p className="m-0 max-w-prose text-body text-ink-2">
              Nothing was lost. You can start the search again with the same details.
            </p>
            <div>
              <Button variant="secondary" onClick={() => void retry()} loading={retrying} loadingText="Restarting">
                <RefreshCw aria-hidden />
                Try the search again
              </Button>
              {retryError ? <p className="m-0 mt-3 text-small text-danger" role="status">{retryError}</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section aria-labelledby="agents-heading" className="grid gap-5">
        <h2 id="agents-heading" className="m-0 font-display text-h2 font-light text-ink display-soft">
          What each search <em className="emph">found</em>
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card, index) => (
            <AgentCard
              key={card.agent}
              card={{ ...card, sources: sources.filter((s) => "agent" in s && s.agent === card.agent) }}
              index={index}
            />
          ))}
        </ul>
      </section>

      <SourceStrip sources={sources} preview={preview} />

      <AnimatePresence>
        {ready ? (
          <motion.section
            key="ready"
            aria-labelledby="ready-heading"
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduced ? { duration: 0 } : SPRING.lively}
            className="grain grid gap-5 rounded-lg border border-ok/30 bg-sage-soft p-6 shadow-lg sm:p-9"
          >
            <h2 id="ready-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
              Your shortlist is <em className="emph">ready</em>
            </h2>
            <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
              {totals.records} records kept, each with a source link. You choose who to contact; nothing is sent until
              you approve it.
            </p>
            <div>
              <Button asChild size="lg">
                <Link href={`/cases/${caseId}/shortlist`}>
                  Review the shortlist
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
