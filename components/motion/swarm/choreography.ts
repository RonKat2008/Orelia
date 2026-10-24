"use client";

import { animate, createSpring, createTimeline, svg } from "animejs";
import type { AgentRunStatus } from "@/lib/contracts";
import { ANIME_EASE, ANIME_SPRING, OPACITY, SCALE, durationMs } from "@/lib/motion/tokens";

/**
 * anime.js v4 choreography for one constellation node. Each function returns a
 * cleanup. CSS (data-status) always holds the FINAL state; anime only animates
 * from the previous state toward it with inline values. On cleanup we
 * `complete()` one-shot animations (jump to their end, which equals the CSS
 * final state) and `revert()` loops (remove inline values entirely).
 */

export interface NodeElements {
  group: SVGGElement;
  live: SVGPathElement;
  halo: SVGCircleElement;
  ping: SVGCircleElement;
  core: SVGCircleElement;
}

type Cleanup = () => void;

const DRAWN: ReadonlySet<AgentRunStatus> = new Set(["running", "done"]);

export function isRouteDrawn(status: AgentRunStatus | undefined): boolean {
  return status !== undefined && DRAWN.has(status);
}

/** Sets the live route to its resting draw state without animating. */
export function primeRoute(live: SVGPathElement, status: AgentRunStatus): void {
  svg.createDrawable(live, 0, isRouteDrawn(status) ? 1 : 0);
}

export function transitionNode(els: NodeElements, from: AgentRunStatus | undefined, to: AgentRunStatus): Cleanup {
  const [route] = svg.createDrawable(els.live);
  const oneShots: Array<{ complete: () => unknown }> = [];
  const loops: Array<{ revert: () => unknown }> = [];
  const needsDraw = !isRouteDrawn(from) && isRouteDrawn(to);

  if (to === "running") {
    if (needsDraw) {
      oneShots.push(
        animate(route, { draw: ["0 0", "0 1"], duration: durationMs("route"), ease: ANIME_EASE.draw }),
      );
    }
    loops.push(
      animate(els.halo, {
        scale: [1, SCALE.breatheTo],
        opacity: [OPACITY.haloRest, OPACITY.halo],
        duration: durationMs("crawl"),
        ease: ANIME_EASE.settle,
        loop: true,
        alternate: true,
      }),
    );
  }

  if (to === "done") {
    const tl = createTimeline({ defaults: { ease: ANIME_EASE.arrive } });
    if (needsDraw) {
      tl.add(route, { draw: ["0 0", "0 1"], duration: durationMs("slow"), ease: ANIME_EASE.draw });
    }
    tl.add(els.halo, { opacity: 0, scale: 1, duration: durationMs("normal") }, needsDraw ? "-=200" : 0).add(
      els.core,
      {
        scale: [SCALE.settleFrom, 1],
        opacity: [0, 1],
        ease: createSpring(ANIME_SPRING.settle),
      },
      "<<",
    );
    oneShots.push(tl);
  }

  if (to === "failed" || to === "not_implemented") {
    const target = to === "failed" ? OPACITY.failed : OPACITY.notImplemented;
    oneShots.push(
      animate(els.group, {
        opacity: [1, target],
        filter: ["saturate(1)", "saturate(0.25)"],
        duration: durationMs("slow"),
        ease: ANIME_EASE.settle,
      }),
    );
    if (isRouteDrawn(from)) {
      oneShots.push(animate(els.live, { opacity: [1, 0], duration: durationMs("slow"), ease: ANIME_EASE.depart }));
    }
  }

  return () => {
    oneShots.forEach((a) => a.complete());
    loops.forEach((a) => a.revert());
  };
}

/** A single outward ripple when an agent reports new results. */
export function pulseNode(els: NodeElements): Cleanup {
  const ripple = animate(els.ping, {
    scale: [1, SCALE.pulseTo],
    opacity: [0.7, 0],
    duration: durationMs("crawl"),
    ease: ANIME_EASE.arrive,
  });
  return () => {
    ripple.revert();
  };
}
