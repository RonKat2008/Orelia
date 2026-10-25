"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { CasePage } from "@/components/outreach/CasePage";
import { Badge, Button, Details, Sheet, toast } from "@/components/ui";
import type { AgentName } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AGENT_LABEL } from "@/lib/motion/status";
import { AgentDetail, STILL_WAITING_MS } from "./AgentCard";
import { SourceStrip } from "./SourceStrip";
import { SwarmOverview } from "./SwarmOverview";
import { connectionBadge, describeProgress, swarmTotals, type AgentCardState } from "./stream";
import { useSwarmStream } from "./useSwarmStream";

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

export function SwarmView({ caseId }: { caseId: string }) {
  const reduced = useReducedMotionGate();
  const swarm = useSwarmStream(caseId);
  const { cards, caseStatus, connection, sources, retry, retrying, retryError, phases } = swarm;
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
  const totals = swarmTotals(cards);
  const preview = connection === "preview";

  // "Not available yet" searches leave the list and the counts; they are named under "Coming later".
  const comingLater = cards.filter((card) => card.status === "not_implemented");

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
      <SourceStrip sources={sources} preview={preview} showTitle={false} />
    ) : selectedCard ? (
      <AgentDetail card={withSources(selectedCard)} stillWaiting={stale.has(selectedCard.agent)} showTitle={false} />
    ) : null;
  const detailTitle = selected === "sources" ? `Sources (${sources.length})` : selectedCard ? AGENT_LABEL[selectedCard.agent] : undefined;

  const overview = (
    <SwarmOverview
      cards={cards}
      caseStatus={caseStatus}
      phases={phases}
      selected={selected}
      onSelectAgent={select}
      sourceCount={sources.length}
      onSelectSources={() => select("sources")}
      sourcesSelected={selected === "sources"}
      preview={preview}
    />
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

        {preview || connection === "polling" ? <ConnectionNote connection={connection} caseStatus={caseStatus} /> : null}
        {overview}
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
        <Sheet open={detailOpen && selectedDetail !== null} onOpenChange={setDetailOpen} title={detailTitle ?? "Details"}>
          {selectedDetail}
        </Sheet>
      </div>
    </CasePage>
  );
}
