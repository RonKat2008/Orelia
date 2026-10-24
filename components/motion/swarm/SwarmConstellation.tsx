"use client";

import "../motion.css";
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
import { ConstellationNode } from "./ConstellationNode";

type Props = {
  agents: SwarmAgent[];
  /** Label for the centre of the map, e.g. the disease name. */
  caseLabel?: string;
  /** Announce status changes in a polite live region. Default true. */
  announce?: boolean;
  className?: string;
};

const RINGS = [64, 112, CONSTELLATION_RADIUS];
const TICKS = 36;

function changedAgent(prev: readonly SwarmAgent[], next: readonly SwarmAgent[]): SwarmAgent | undefined {
  return next.find((agent) => {
    const before = prev.find((p) => p.name === agent.name);
    return !before || before.status !== agent.status;
  });
}

/**
 * The live research swarm as a constellation: your case at the centre, one route
 * out to each research agent. The SVG is decorative-plus-summary; the ordered
 * list beside it is the full text equivalent and is always visible.
 */
export function SwarmConstellation({ agents, caseLabel = "Your case", announce = true, className }: Props) {
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
  const points = layoutConstellation(agents.length, {
    cx: CONSTELLATION_CENTER.x,
    cy: CONSTELLATION_CENTER.y,
    radius: CONSTELLATION_RADIUS,
  });
  const summary = summarizeSwarm(agents);
  const classes = ["wf-constellation", className].filter(Boolean).join(" ");

  return (
    <figure className={classes} data-reduced={reduced ? "true" : "false"}>
      <div className="wf-constellation__map">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
          <title id={titleId}>{summary}</title>
          <g className="wf-constellation__contours" aria-hidden="true">
            {RINGS.map((r) => (
              <circle key={r} cx={CONSTELLATION_CENTER.x} cy={CONSTELLATION_CENTER.y} r={r} />
            ))}
            {Array.from({ length: TICKS }, (_, i) => (
              <line
                key={i}
                x1={CONSTELLATION_CENTER.x}
                y1={CONSTELLATION_CENTER.y - 200}
                x2={CONSTELLATION_CENTER.x}
                y2={CONSTELLATION_CENTER.y - (i % 9 === 0 ? 188 : 194)}
                transform={`rotate(${(360 / TICKS) * i} ${CONSTELLATION_CENTER.x} ${CONSTELLATION_CENTER.y})`}
              />
            ))}
          </g>
          {agents.map((agent, i) => (
            <ConstellationNode
              key={agent.name}
              agent={agent}
              point={points[i]}
              center={CONSTELLATION_CENTER}
              reduced={reduced}
            />
          ))}
          <g className="wf-constellation__case" aria-hidden="true">
            <circle cx={CONSTELLATION_CENTER.x} cy={CONSTELLATION_CENTER.y} r={24} />
            <path
              d={`M ${CONSTELLATION_CENTER.x} ${CONSTELLATION_CENTER.y - 11} L ${CONSTELLATION_CENTER.x + 4} ${CONSTELLATION_CENTER.y} L ${CONSTELLATION_CENTER.x} ${CONSTELLATION_CENTER.y + 11} L ${CONSTELLATION_CENTER.x - 4} ${CONSTELLATION_CENTER.y} Z`}
            />
          </g>
        </svg>
        <p className="wf-constellation__case-label">{caseLabel}</p>
      </div>
      <figcaption className="wf-constellation__legend">
        <p className="wf-constellation__summary">{summary}</p>
        <ol className="wf-constellation__list">
          {agents.map((agent) => {
            const presentation = STATUS_PRESENTATION[agent.status];
            const counts = describeCounts(agent.counts);
            return (
              <li key={agent.name} data-tone={presentation.tone} data-status={agent.status}>
                <span className="wf-constellation__dot" aria-hidden="true" />
                <span className="wf-constellation__name">{AGENT_LABEL[agent.name]}</span>
                <span className="wf-constellation__status">{presentation.label}</span>
                {counts ? <span className="wf-constellation__counts">{counts}</span> : null}
              </li>
            );
          })}
        </ol>
      </figcaption>
      {announce ? (
        <p className="wf-visually-hidden" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      ) : null}
    </figure>
  );
}
