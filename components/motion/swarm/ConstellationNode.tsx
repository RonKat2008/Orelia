"use client";

import { useEffect, useRef } from "react";
import type { AgentRunStatus } from "@/lib/contracts";
import type { Point } from "@/lib/motion/constellation";
import { routePath } from "@/lib/motion/constellation";
import { AGENT_SHORT_LABEL, STATUS_PRESENTATION, totalCount, type SwarmAgent } from "@/lib/motion/status";
import { useIsomorphicLayoutEffect } from "../useIsomorphicLayoutEffect";
import { primeRoute, pulseNode, transitionNode, type NodeElements } from "./choreography";

interface ConstellationNodeProps {
  agent: SwarmAgent;
  point: Point;
  center: Point;
  reduced: boolean;
}

const LABEL_OFFSET = 30;

function labelPosition(point: Point, center: Point) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const x = point.x + (dx / len) * LABEL_OFFSET;
  const y = point.y + (dy / len) * LABEL_OFFSET;
  const anchor = Math.abs(dx) < 8 ? "middle" : dx > 0 ? "start" : "end";
  return { x, y: y + 4, anchor } as const;
}

export function ConstellationNode({ agent, point, center, reduced }: ConstellationNodeProps) {
  const groupRef = useRef<SVGGElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const pingRef = useRef<SVGCircleElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const prevStatus = useRef<AgentRunStatus | undefined>(undefined);
  const prevTotal = useRef(totalCount(agent.counts));

  const { status } = agent;
  const total = totalCount(agent.counts);
  const d = routePath(center, point);
  const label = labelPosition(point, center);
  const tone = STATUS_PRESENTATION[status].tone;

  useIsomorphicLayoutEffect(() => {
    const els = collect(groupRef.current, liveRef.current, haloRef.current, pingRef.current, coreRef.current);
    const from = prevStatus.current;
    prevStatus.current = status;
    if (!els || reduced) return;
    if (from === undefined) {
      primeRoute(els.live, status);
      return;
    }
    if (from === status) return;
    return transitionNode(els, from, status);
  }, [status, reduced]);

  useEffect(() => {
    const grew = total > prevTotal.current;
    prevTotal.current = total;
    if (!grew || reduced || status !== "running") return;
    const els = collect(groupRef.current, liveRef.current, haloRef.current, pingRef.current, coreRef.current);
    return els ? pulseNode(els) : undefined;
  }, [total, reduced, status]);

  return (
    <g className="wf-node" data-status={status} data-tone={tone}>
      <path className="wf-node__planned" d={d} />
      <path ref={liveRef} className="wf-node__live" d={d} />
      <g ref={groupRef} className="wf-node__body">
        <circle ref={haloRef} className="wf-node__halo" cx={point.x} cy={point.y} r={15} />
        <circle ref={pingRef} className="wf-node__ping" cx={point.x} cy={point.y} r={11} />
        <circle className="wf-node__ring" cx={point.x} cy={point.y} r={10} />
        <circle ref={coreRef} className="wf-node__core" cx={point.x} cy={point.y} r={5} />
        <text className="wf-node__label" x={label.x} y={label.y} textAnchor={label.anchor}>
          {AGENT_SHORT_LABEL[agent.name]}
        </text>
      </g>
    </g>
  );
}

function collect(
  group: SVGGElement | null,
  live: SVGPathElement | null,
  halo: SVGCircleElement | null,
  ping: SVGCircleElement | null,
  core: SVGCircleElement | null,
): NodeElements | null {
  if (!group || !live || !halo || !ping || !core) return null;
  return { group, live, halo, ping, core };
}
