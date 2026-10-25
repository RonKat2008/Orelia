"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, CircleDashed, Link2, X } from "lucide-react";
import type { AgentRunStatus } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AGENT_LABEL } from "@/lib/motion/status";
import { cn } from "@/lib/ui/cn";
import { countsLine } from "./AgentCard";
import {
  stageRows,
  summaryLine,
  visibleCards,
  type StageRow,
  type StageState,
} from "./overview";
import { NARRATIVE, type AgentCardState, type PhaseRuns } from "./stream";

const DOT: Record<AgentRunStatus, string> = {
  queued: "bg-ink-3/50",
  running: "bg-teal",
  done: "bg-ok",
  failed: "bg-danger",
  not_implemented: "bg-ink-3/40",
};

const STATUS_TEXT: Record<AgentRunStatus, string> = {
  queued: "Waiting",
  running: "Searching",
  done: "Done",
  failed: "Could not finish",
  not_implemented: "Not available",
};

const STAGE_TEXT: Record<StageState, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Done",
  failed: "Stopped",
};

/** Thin bar: shimmer while running, full when done, muted when failed or unavailable. */
function RowBar({
  status,
  reduced,
}: {
  status: AgentRunStatus;
  reduced: boolean;
}) {
  const settled = status === "done";
  const muted = status === "failed" || status === "not_implemented";
  return (
    <span
      aria-hidden
      className="relative block h-1 w-full overflow-hidden rounded-pill bg-paper-2"
    >
      {status === "running" ? (
        reduced ? (
          <span className="absolute inset-y-0 left-0 w-1/2 rounded-pill bg-teal/70" />
        ) : (
          <motion.span
            className="absolute inset-y-0 left-0 w-2/5 rounded-pill bg-teal"
            initial={{ x: "-100%" }}
            animate={{ x: "250%" }}
            transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
          />
        )
      ) : (
        <motion.span
          className={cn(
            "absolute inset-0 origin-left rounded-pill",
            settled ? "bg-ok" : muted ? "bg-ink-3/30" : "bg-transparent",
          )}
          initial={false}
          animate={{ scaleX: settled || muted ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </span>
  );
}

function AgentTile({
  card,
  index,
  reduced,
  selected,
  onSelect,
}: {
  card: AgentCardState;
  index: number;
  reduced: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { status } = card;
  const counts = countsLine(card);
  const line =
    status === "done" && counts
      ? `${counts.records} kept · ${counts.sources} ${counts.sources === 1 ? "source" : "sources"}`
      : status === "running"
        ? `${NARRATIVE[card.agent]}…`
        : status === "failed"
          ? "Hit a problem; the others carry on"
          : status === "queued"
            ? "Waiting for a turn"
            : "";
  return (
    <motion.li
      layout="position"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0 : 0.35,
        delay: reduced ? 0 : Math.min(index, 8) * 0.03,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="m-0 min-w-0 list-none"
      data-status={status}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex h-full w-full min-w-0 cursor-pointer flex-col items-stretch gap-1.5 rounded-md border bg-card px-3 py-2.5 text-left text-ink outline-none transition-colors",
          "hover:border-ink-3/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected ? "border-teal" : "border-line",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full transition-colors duration-500",
              DOT[status],
              status === "running" &&
                "animate-pulse motion-reduce:animate-none",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-small font-semibold">
            {AGENT_LABEL[card.agent]}
          </span>
          <span className="shrink-0 text-xs text-ink-2">
            {STATUS_TEXT[status]}
          </span>
        </span>
        <RowBar status={status} reduced={reduced} />
        <span className="relative block min-h-[1.25rem] overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${status}-${line}`}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: 0, y: -4 }
              }
              transition={{ duration: reduced ? 0 : 0.25 }}
              className="block truncate text-xs text-ink-2 tabular-nums"
            >
              {line || " "}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
    </motion.li>
  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "done")
    return <Check aria-hidden className="size-3.5 text-ok" />;
  if (state === "failed")
    return <X aria-hidden className="size-3.5 text-danger" />;
  if (state === "running")
    return (
      <span
        aria-hidden
        className="block size-2 animate-pulse rounded-full bg-teal motion-reduce:animate-none"
      />
    );
  return <CircleDashed aria-hidden className="size-3.5 text-ink-3" />;
}

function StageLine({
  stage,
  number,
  reduced,
}: {
  stage: StageRow;
  number: number;
  reduced: boolean;
}) {
  return (
    <motion.li
      layout="position"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
      data-testid={`stage-${stage.id}`}
      data-state={stage.state}
      className={cn(
        "m-0 flex min-w-0 list-none items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-500",
        stage.state === "running"
          ? "border-teal/50 bg-card"
          : stage.state === "done"
            ? "border-line bg-card"
            : "border-line bg-paper-2/50",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line text-xs tabular-nums text-ink-2">
        {number}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
        <span className="text-small font-semibold text-ink">{stage.label}</span>
        <span className="min-w-0 text-xs text-ink-2 [overflow-wrap:anywhere]">
          {stage.detail}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-2">
        <StageIcon state={stage.state} />
        {STAGE_TEXT[stage.state]}
      </span>
    </motion.li>
  );
}

/** The calm judge overview: one summary line, the searches as compact rows, then the later stages. No connectors. */
export function SwarmOverview({
  cards,
  caseStatus,
  phases,
  selected,
  onSelectAgent,
  sourceCount,
  onSelectSources,
  sourcesSelected,
  preview,
}: {
  cards: AgentCardState[];
  caseStatus?: string;
  phases: PhaseRuns;
  selected: string | null;
  onSelectAgent: (agent: AgentCardState["agent"]) => void;
  sourceCount: number;
  onSelectSources: () => void;
  sourcesSelected: boolean;
  preview: boolean;
}) {
  const reduced = useReducedMotionGate();
  const available = visibleCards(cards, caseStatus === "ready");
  const stages = stageRows(cards, caseStatus, phases);
  return (
    <div className="grid min-w-0 gap-4" data-testid="swarm-overview">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          className="m-0 text-body font-semibold text-ink tabular-nums"
          data-testid="swarm-summary"
        >
          {summaryLine(cards, caseStatus === "ready")}
        </p>
        {preview || sourceCount > 0 ? (
          <button
            type="button"
            onClick={onSelectSources}
            aria-pressed={sourcesSelected}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-small text-ink-2 underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Link2 aria-hidden className="size-3.5" />
            {preview
              ? "Example sources"
              : `View ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`}
          </button>
        ) : null}
      </div>

      <section aria-labelledby="stage-research" className="grid gap-2">
        <h2
          id="stage-research"
          className="m-0 text-xs font-semibold uppercase tracking-wider text-ink-2"
        >
          1 · Research
        </h2>
        <ul
          aria-label="Searches"
          className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2"
        >
          {available.map((card, index) => (
            <AgentTile
              key={card.agent}
              card={card}
              index={index}
              reduced={reduced}
              selected={selected === card.agent}
              onSelect={() => onSelectAgent(card.agent)}
            />
          ))}
        </ul>
      </section>

      <ul aria-label="Later stages" className="m-0 grid list-none gap-2 p-0">
        {stages.map((stage, i) => (
          <StageLine
            key={stage.id}
            stage={stage}
            number={i + 2}
            reduced={reduced}
          />
        ))}
      </ul>
    </div>
  );
}
