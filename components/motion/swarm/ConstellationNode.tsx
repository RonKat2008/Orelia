"use client";

import { useEffect, useRef } from "react";
import type { AgentRunStatus } from "@/lib/contracts";
import type { Point } from "@/lib/motion/constellation";
import { routePath } from "@/lib/motion/constellation";
import { AGENT_SHORT_LABEL, STATUS_PRESENTATION, totalCount, type SwarmAgent } from "@/lib/motion/status";
import { cn } from "@/lib/ui/cn";
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

  const box = "[transform-box:fill-box] origin-center";
  return (
    <g className="group/node" data-status={status} data-tone={tone}>
      <title>{`${AGENT_SHORT_LABEL[agent.name]}: ${STATUS_PRESENTATION[status].label.toLowerCase()}`}</title>
      <path
        className="fill-none stroke-line-strong stroke-[1.25] [stroke-dasharray:1.5_5] [stroke-linecap:round] group-data-[status=failed]/node:stroke-danger/60"
        d={d}
      />
      <path
        ref={liveRef}
        className={cn(
          "fill-none stroke-2 [stroke-linecap:round] transition-opacity duration-300 motion-reduce:transition-none",
          "stroke-teal opacity-0 group-data-[status=running]/node:opacity-100",
          "group-data-[status=done]/node:stroke-ok group-data-[status=done]/node:opacity-100",
        )}
        d={d}
      />
      <g
        ref={groupRef}
        className={cn(
          box,
          "group-data-[status=failed]/node:opacity-70 group-data-[status=not_implemented]/node:opacity-50",
        )}
      >
        <circle
          ref={haloRef}
          className={cn(box, "fill-teal opacity-0 group-data-[status=running]/node:opacity-20")}
          cx={point.x}
          cy={point.y}
          r={15}
        />
        <circle
          ref={pingRef}
          className={cn(box, "fill-none stroke-teal stroke-[1.5] opacity-0")}
          cx={point.x}
          cy={point.y}
          r={11}
        />
        <circle
          className={cn(
            "fill-card stroke-line-strong stroke-[1.75]",
            "group-data-[status=running]/node:stroke-teal group-data-[status=done]/node:stroke-ok",
            "group-data-[status=failed]/node:stroke-danger group-data-[status=not_implemented]/node:[stroke-dasharray:3_3]",
          )}
          cx={point.x}
          cy={point.y}
          r={10}
        />
        <circle
          ref={coreRef}
          className={cn(
            box,
            "fill-teal opacity-0 group-data-[status=running]/node:opacity-50 group-data-[status=running]/node:scale-[0.6]",
            "group-data-[status=done]/node:fill-ok group-data-[status=done]/node:opacity-100",
            "group-data-[status=failed]/node:fill-danger group-data-[status=failed]/node:opacity-100 group-data-[status=failed]/node:scale-50",
          )}
          cx={point.x}
          cy={point.y}
          r={5}
        />
        <path
          aria-hidden
          d={`M ${point.x - 3.2} ${point.y} l 2.2 2.4 l 4.2 -4.8`}
          className="fill-none stroke-on-teal stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round] opacity-0 group-data-[status=done]/node:opacity-100"
        />
        <text
          className={cn(
            "fill-ink-2 text-[15px] max-sm:hidden",
            "group-data-[status=running]/node:fill-ink group-data-[status=done]/node:fill-ink",
          )}
          x={label.x}
          y={label.y}
          textAnchor={label.anchor}
        >
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
