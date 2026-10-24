"use client";

import { useId, useState } from "react";
import {
  CONSTELLATION_CENTER,
  CONSTELLATION_RADIUS,
  CONSTELLATION_VIEWBOX,
  layoutConstellation,
} from "@/lib/motion/constellation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import {
  AGENT_LABEL,
  STATUS_PRESENTATION,
  announceAgent,
  describeCounts,
  summarizeSwarm,
  type SwarmAgent,
} from "@/lib/motion/status";
import { cn } from "@/lib/ui/cn";
import { ConstellationNode } from "./ConstellationNode";

type Props = {
  agents: SwarmAgent[];
  /** Label for the centre of the map, e.g. the disease name. */
  caseLabel?: string;
  /** Announce status changes in a polite live region. Default true. */
  announce?: boolean;
  /** Show the written list beside the map. Turn off when the page already lists every agent. */
  showLegend?: boolean;
  className?: string;
};

const RINGS = [64, 112, CONSTELLATION_RADIUS];
/** Horizontal room for the longest node labels on either side. */
const LABEL_GUTTER = 56;
const TICKS = 36;
const CENTER = CONSTELLATION_CENTER;

function changedAgent(prev: readonly SwarmAgent[], next: readonly SwarmAgent[]): SwarmAgent | undefined {
  return next.find((agent) => {
    const before = prev.find((p) => p.name === agent.name);
    return !before || before.status !== agent.status;
  });
}

const toneText: Record<string, string> = {
  quiet: "text-ink-3",
  pending: "text-teal-ink dark:text-teal",
  verified: "text-ok",
  failed: "text-danger",
  neutral: "text-ink-2",
};

/**
 * The live research swarm as a map: the case at the centre, one route out to each
 * research agent. The SVG is a summary; the written list (or the agent cards on
 * the swarm page) is the full text equivalent.
 */
export function SwarmConstellation({
  agents,
  caseLabel = "Your case",
  announce = true,
  showLegend = true,
  className,
}: Props) {
  const reduced = useReducedMotionGate();
  const titleId = useId();
  const [prevAgents, setPrevAgents] = useState(agents);
  const [message, setMessage] = useState("");

  // Derive the announcement during render (React's "storing info from previous renders" pattern).
  if (prevAgents !== agents) {
    const changed = changedAgent(prevAgents, agents);
    setPrevAgents(agents);
    if (changed) setMessage(announceAgent(changed));
  }

  const { width, height } = CONSTELLATION_VIEWBOX;
  const points = layoutConstellation(agents.length, { cx: CENTER.x, cy: CENTER.y, radius: CONSTELLATION_RADIUS });
  const summary = summarizeSwarm(agents);
  const anyRunning = agents.some((agent) => agent.status === "running");

  return (
    <figure
      className={cn("m-0 [container-type:inline-size]", className)}
      data-reduced={reduced ? "true" : "false"}
    >
      <div className={cn("grid items-center gap-8", showLegend && "@[1000px]:grid-cols-[1.15fr_0.85fr]")}>
        <div className="relative mx-auto w-full max-w-[38rem]">
          <svg
            viewBox={`${-LABEL_GUTTER} 0 ${width + LABEL_GUTTER * 2} ${height}`}
            role="img"
            aria-labelledby={titleId}
            className="block h-auto w-full overflow-visible"
          >
            <title id={titleId}>{summary}</title>
            <g aria-hidden="true" className="fill-none">
              {RINGS.map((r, i) => (
                <circle
                  key={r}
                  cx={CENTER.x}
                  cy={CENTER.y}
                  r={r}
                  className={cn(
                    "stroke-line",
                    i === RINGS.length - 1 && "stroke-line-strong [stroke-dasharray:1_6] [stroke-linecap:round]",
                  )}
                />
              ))}
              {Array.from({ length: TICKS }, (_, i) => (
                <line
                  key={i}
                  x1={CENTER.x}
                  y1={CENTER.y - 200}
                  x2={CENTER.x}
                  y2={CENTER.y - (i % 9 === 0 ? 188 : 194)}
                  className="stroke-line-strong"
                  transform={`rotate(${(360 / TICKS) * i} ${CENTER.x} ${CENTER.y})`}
                />
              ))}
            </g>
            {anyRunning && !reduced ? (
              <circle
                aria-hidden
                cx={CENTER.x}
                cy={CENTER.y}
                r={26}
                className="animate-ping fill-none stroke-teal/50 stroke-[1.5] [transform-box:fill-box] origin-center motion-reduce:animate-none"
              />
            ) : null}
            {agents.map((agent, i) => (
              <ConstellationNode key={agent.name} agent={agent} point={points[i]} center={CENTER} reduced={reduced} />
            ))}
            <g aria-hidden="true">
              <circle cx={CENTER.x} cy={CENTER.y} r={26} className="fill-ink" />
              <path
                d={`M ${CENTER.x} ${CENTER.y - 12} L ${CENTER.x + 5} ${CENTER.y} L ${CENTER.x} ${CENTER.y + 12} L ${CENTER.x - 5} ${CENTER.y} Z`}
                className="fill-paper"
              />
              <circle cx={CENTER.x} cy={CENTER.y} r={2} className="fill-terracotta" />
            </g>
          </svg>
          <p className="m-0 mt-2 text-center font-display text-h4 font-normal italic text-ink">{caseLabel}</p>
        </div>
        {showLegend ? (
          <div className="grid gap-4">
            <p className="m-0 font-display text-h4 font-normal text-ink">{summary}</p>
            <ol className="m-0 grid list-none gap-0 border-t border-line p-0">
              {agents.map((agent) => {
                const presentation = STATUS_PRESENTATION[agent.status];
                const counts = describeCounts(agent.counts);
                return (
                  <li
                    key={agent.name}
                    data-tone={presentation.tone}
                    data-status={agent.status}
                    className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-line py-2 text-small"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 self-center rounded-pill border-[1.5px] border-current",
                        toneText[presentation.tone],
                        (agent.status === "done" || agent.status === "failed") && "bg-current",
                      )}
                    />
                    <span className="text-ink">{AGENT_LABEL[agent.name]}</span>
                    <span className={cn("text-right font-semibold", toneText[presentation.tone])}>
                      {presentation.label}
                    </span>
                    {counts ? <span className="col-span-2 col-start-2 text-ink-2">{counts}</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>
      {announce ? (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      ) : null}
    </figure>
  );
}
