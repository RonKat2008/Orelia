"use client";

import "./motion.css";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentName, AgentRunStatus } from "@/lib/contracts";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { AGENT_LABEL, STATUS_PRESENTATION, describeCounts } from "@/lib/motion/status";
import { enterVariants } from "@/lib/motion/variants";
import { DISTANCE } from "@/lib/motion/tokens";

type Props = {
  name: AgentName;
  status: AgentRunStatus;
  counts?: Record<string, number>;
  /** Overrides the default human label for the agent. */
  title?: string;
  /** Put the status line in a polite live region. Off by default to avoid double announcements. */
  live?: boolean;
  children?: ReactNode;
};

/**
 * Card shell for one research agent. The card fades up on mount; the status
 * line cross-fades when the status changes, so the change is noticed without
 * the card itself moving.
 */
export function AgentCardMotion({ name, status, counts, title, live = false, children }: Props) {
  const reduced = useReducedMotionGate();
  const presentation = STATUS_PRESENTATION[status];
  const swap = enterVariants(reduced, DISTANCE.xs);
  const countText = describeCounts(counts);

  return (
    <motion.article
      className="wf-agent-card"
      data-tone={presentation.tone}
      data-status={status}
      variants={enterVariants(reduced)}
      initial={reduced ? false : "hidden"}
      animate="visible"
    >
      <header className="wf-agent-card__head">
        <span className="wf-agent-card__marker" aria-hidden="true" />
        <h3 className="wf-agent-card__title">{title ?? AGENT_LABEL[name]}</h3>
      </header>
      <p className="wf-agent-card__status" aria-live={live ? "polite" : undefined} aria-atomic="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            className="wf-agent-card__status-text"
            variants={swap}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {presentation.label}
          </motion.span>
        </AnimatePresence>
      </p>
      {countText ? <p className="wf-agent-card__counts">{countText}</p> : null}
      {children}
    </motion.article>
  );
}
