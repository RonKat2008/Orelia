"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, CircleDashed, Clock, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AgentRunStatus } from "@/lib/contracts";
import { Badge, SourceChip, type BadgeProps } from "@/components/ui";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AGENT_LABEL, STATUS_PRESENTATION } from "@/lib/motion/status";
import { enterVariants } from "@/lib/motion/variants";
import { cn } from "@/lib/ui/cn";
import { NARRATIVE, type AgentCardState } from "./stream";

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
  queued: "bg-paper-2 text-ink-3",
  running: "bg-teal-soft text-teal-ink dark:text-teal",
  done: "bg-ok-soft text-ok",
  failed: "bg-danger-soft text-danger",
  not_implemented: "bg-paper-2 text-ink-2",
};

export const countsLine = (card: AgentCardState): { records: number; sources: number } | null => {
  const records = card.counts?.records;
  const sources = card.counts?.evidence;
  if (records === undefined && sources === undefined) return null;
  return { records: records ?? 0, sources: sources ?? 0 };
};

function CountFigure({ value, label }: { value: number; label: string }) {
  const reduced = useReducedMotionGate();
  const swap = enterVariants(reduced, 6);
  return (
    <div className="grid gap-0.5">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          variants={swap}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="font-display text-h3 font-light leading-none tabular-nums text-ink"
        >
          {value}
        </motion.span>
      </AnimatePresence>
      <span className="text-small text-ink-2">{label}</span>
    </div>
  );
}

export function AgentCard({ card, index }: { card: AgentCardState; index: number }) {
  const reduced = useReducedMotionGate();
  const { status } = card;
  const Icon = ICONS[status];
  const counts = countsLine(card);
  const headingId = `agent-${card.agent}`;

  return (
    <motion.li
      layout={reduced ? false : "position"}
      variants={enterVariants(reduced)}
      initial={reduced ? false : "hidden"}
      animate="visible"
      transition={{ delay: reduced ? 0 : index * 0.05 }}
      data-status={status}
      aria-labelledby={headingId}
      className={cn(
        "relative grid content-start gap-4 overflow-hidden rounded-lg border bg-card p-5 shadow-xs",
        "transition-[border-color,box-shadow] duration-300 ease-out-expo hover:border-line-strong hover:shadow-md motion-reduce:transition-none",
        status === "running" ? "border-teal/40 shadow-sm" : "border-line",
        status === "queued" && "bg-paper-2/50",
        status === "failed" && "border-danger/35",
      )}
    >
      {status === "running" ? (
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-teal motion-reduce:animate-none" />
      ) : null}
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-pill", ICON_TONE[status])}>
          <Icon className={cn("size-5", status === "running" && "animate-spin motion-reduce:animate-none")} />
        </span>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <h3 id={headingId} className="m-0 font-sans text-h4 font-bold text-ink">
            {AGENT_LABEL[card.agent]}
          </h3>
          <Badge tone={BADGE_TONE[status]} size="sm">
            {STATUS_PRESENTATION[status].label}
          </Badge>
        </div>
      </div>

      {status === "running" ? <p className="m-0 text-small text-ink-2">{NARRATIVE[card.agent]}…</p> : null}
      {status === "queued" ? <p className="m-0 text-small text-ink-3">Waiting for a turn.</p> : null}

      {counts ? (
        <div className="flex gap-8">
          <CountFigure value={counts.records} label={counts.records === 1 ? "record kept" : "records kept"} />
          <CountFigure value={counts.sources} label={counts.sources === 1 ? "source" : "sources"} />
        </div>
      ) : null}

      {card.error ? (
        <p className="m-0 rounded-md bg-danger-soft px-3 py-2 text-small text-ink">
          This search hit a problem. The others carry on.
        </p>
      ) : null}
      {status === "not_implemented" ? (
        <p className="m-0 text-small text-ink-2">This search is not part of the first release.</p>
      ) : null}

      {card.sources && card.sources.length > 0 ? (
        <ul aria-label={`Latest sources from ${AGENT_LABEL[card.agent]}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {card.sources.slice(-2).map((source) => (
            <li key={source.url} className="min-w-0 max-w-full">
              <SourceChip url={source.url} title={source.title} verified={source.verified} />
            </li>
          ))}
        </ul>
      ) : null}
    </motion.li>
  );
}
