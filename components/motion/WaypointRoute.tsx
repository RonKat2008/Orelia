"use client";

import "./motion.css";
import { useRef } from "react";
import { createTimeline, stagger, svg } from "animejs";
import { waypointRoute } from "@/lib/motion/constellation";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { ANIME_EASE, STAGGER, durationMs } from "@/lib/motion/tokens";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";

type Waypoint = { id: string; label: string; count?: number };

type Props = {
  waypoints: Waypoint[];
  /** Accessible description of the route, e.g. "Your shortlist: four kinds of help". */
  label: string;
};

const WIDTH = 640;
const HEIGHT = 96;

/**
 * The shortlist header: a winding route through one waypoint per resource kind.
 * The route draws once on mount, then each waypoint lands in turn.
 */
export function WaypointRoute({ waypoints, label }: Props) {
  const reduced = useReducedMotionGate();
  const rootRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const { d, points } = waypointRoute(waypoints.length, WIDTH, HEIGHT);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const path = pathRef.current;
    if (!root || !path || reduced) return;
    const marks = root.querySelectorAll<SVGGElement>(".wf-waypoint__mark");
    const [drawable] = svg.createDrawable(path, 0, 0);
    const tl = createTimeline({ defaults: { ease: ANIME_EASE.arrive } })
      .add(drawable, { draw: ["0 0", "0 1"], duration: durationMs("crawl"), ease: ANIME_EASE.draw })
      .add(
        marks,
        { opacity: [0, 1], scale: [0.4, 1], duration: durationMs("slow"), delay: stagger(STAGGER.waypoint) },
        "-=1100",
      );
    return () => {
      tl.complete();
    };
  }, [reduced, d]);

  return (
    <div className="wf-waypoints">
      <svg
        ref={rootRef}
        className="wf-waypoints__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path ref={pathRef} className="wf-waypoints__route" d={d} />
        {points.map((p, i) => (
          <g key={waypoints[i].id} className="wf-waypoint__mark" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
            <circle className="wf-waypoint__outer" cx={p.x} cy={p.y} r={9} />
            <circle className="wf-waypoint__inner" cx={p.x} cy={p.y} r={3.5} />
          </g>
        ))}
      </svg>
      <ol className="wf-waypoints__labels" aria-label={label}>
        {waypoints.map((w) => (
          <li key={w.id}>
            <span className="wf-waypoints__name">{w.label}</span>
            {w.count !== undefined ? <span className="wf-waypoints__count">{w.count} found</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
