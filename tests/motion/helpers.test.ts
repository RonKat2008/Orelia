import { describe, expect, it, vi } from "vitest";
import { agentNameSchema } from "@/lib/contracts";
import { layoutConstellation, routePath, waypointRoute } from "@/lib/motion/constellation";
import {
  INSTANT_TRANSITION,
  REDUCED_MOTION_QUERY,
  pickMotion,
  readPrefersReducedMotion,
  subscribeReducedMotion,
} from "@/lib/motion/reduced-motion";
import { computeScoreSegments, formatPoints } from "@/lib/motion/score";
import { applySwarmEvent, buildSwarmSchedule, initialSwarm, SIMULATION_LENGTH_MS } from "@/lib/motion/simulate";
import { AGENT_LABEL, AGENT_ORDER, announceAgent, STATUS_PRESENTATION, summarizeSwarm } from "@/lib/motion/status";
import { DURATION, durationMs, STAGGER } from "@/lib/motion/tokens";
import { enterVariants, revealVariants, segmentTransition, staggerDelay } from "@/lib/motion/variants";

describe("motion tokens", () => {
  it("converts durations to milliseconds for anime.js", () => {
    expect(durationMs("normal")).toBe(350);
    expect(durationMs("route")).toBe(Math.round(DURATION.route * 1000));
  });

  it("keeps the list stagger within 50–100ms", () => {
    expect(STAGGER.list).toBeGreaterThanOrEqual(0.05);
    expect(STAGGER.list).toBeLessThanOrEqual(0.1);
  });
});

describe("reduced-motion gate", () => {
  it("returns false when matchMedia is unavailable (server)", () => {
    expect(readPrefersReducedMotion(null)).toBe(false);
  });

  it("reads the media query", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    expect(readPrefersReducedMotion(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("treats a throwing matchMedia as no preference", () => {
    expect(
      readPrefersReducedMotion(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it("subscribes and unsubscribes to changes", () => {
    const add = vi.fn();
    const remove = vi.fn();
    const onChange = () => {};
    const unsubscribe = subscribeReducedMotion(onChange, () => ({
      matches: false,
      addEventListener: add,
      removeEventListener: remove,
    }));
    expect(add).toHaveBeenCalledWith("change", onChange);
    unsubscribe();
    expect(remove).toHaveBeenCalledWith("change", onChange);
  });

  it("is a no-op subscription on the server", () => {
    expect(() => subscribeReducedMotion(() => {}, null)()).not.toThrow();
  });

  it("picks the still value when reduced", () => {
    expect(pickMotion(true, "animated", "still")).toBe("still");
    expect(pickMotion(false, "animated", "still")).toBe("animated");
  });
});

describe("variants under reduced motion render the final state", () => {
  it("enter: hidden equals visible, instant", () => {
    const v = enterVariants(true);
    expect(v.hidden).toEqual(v.visible);
    expect(v.hidden.transition).toEqual(INSTANT_TRANSITION);
    expect(v.hidden.y).toBe(0);
  });

  it("enter: animated version starts offset and transparent", () => {
    const v = enterVariants(false, 10);
    expect(v.hidden).toEqual({ opacity: 0, y: 10 });
    expect(v.visible.opacity).toBe(1);
  });

  it("reveal: hidden is already fully open", () => {
    const v = revealVariants(true);
    expect(v.hidden.clipPath).toBe("inset(0% 0% 0% 0%)");
    expect(v.hidden.opacity).toBe(1);
  });

  it("segments and stagger have no delay or duration", () => {
    expect(segmentTransition(true, 3)).toEqual(INSTANT_TRANSITION);
    expect(staggerDelay(true, 5)).toBe(0);
    expect(staggerDelay(false, 100)).toBeCloseTo(STAGGER.lead + 8 * STAGGER.list);
  });
});

describe("constellation geometry", () => {
  it("places nine nodes on the circle, first at 12 o'clock", () => {
    const points = layoutConstellation(9, { cx: 100, cy: 100, radius: 50 });
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual({ x: 100, y: 50 });
    for (const p of points) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(50, 1);
  });

  it("rejects invalid counts", () => {
    expect(() => layoutConstellation(-1, { cx: 0, cy: 0, radius: 1 })).toThrow();
  });

  it("builds a bowed quadratic route", () => {
    expect(routePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1)).toBe("M 0 0 Q 50 10 100 0");
  });

  it("builds a waypoint route through every point", () => {
    const { d, points } = waypointRoute(4, 640, 96);
    expect(points).toHaveLength(4);
    expect(d.startsWith(`M ${points[0].x} ${points[0].y}`)).toBe(true);
    expect(d.match(/C /g)).toHaveLength(3);
    expect(waypointRoute(0, 640, 96).d).toBe("");
  });
});

describe("score segments", () => {
  const items = [
    { factor: "a", points: 30, text: "A", evidenceIds: ["1", "2"] },
    { factor: "b", points: 10, text: "B", evidenceIds: [] },
    { factor: "c", points: -5, text: "C", evidenceIds: ["3"] },
  ];

  it("lays positive factors end to end and skips deductions", () => {
    const segments = computeScoreSegments(items);
    expect(segments.map((s) => [s.start, s.size])).toEqual([
      [0, 0.75],
      [0.75, 0.25],
      [1, 0],
    ]);
    expect(segments[2].tone).toBe(-1);
    expect(segments[0].evidenceCount).toBe(2);
  });

  it("scales to an explicit max but never overflows", () => {
    expect(computeScoreSegments(items, 80)[0].size).toBeCloseTo(0.375);
    expect(computeScoreSegments(items, 10)[0].size).toBeCloseTo(0.75);
  });

  it("does not mutate input and handles empty lists", () => {
    const copy = structuredClone(items);
    computeScoreSegments(items);
    expect(items).toEqual(copy);
    expect(computeScoreSegments([])).toEqual([]);
  });

  it("formats points with a sign", () => {
    expect(formatPoints(12)).toBe("+12");
    expect(formatPoints(-4)).toBe("-4");
    expect(formatPoints(0)).toBe("0");
  });
});

describe("status presentation", () => {
  it("covers every agent", () => {
    expect([...AGENT_ORDER].sort()).toEqual([...agentNameSchema.options].sort());
    for (const name of agentNameSchema.options) expect(AGENT_LABEL[name]).toBeTruthy();
  });

  it("marks only terminal states as settled", () => {
    expect(STATUS_PRESENTATION.done.settled).toBe(true);
    expect(STATUS_PRESENTATION.failed.tone).toBe("failed");
    expect(STATUS_PRESENTATION.not_implemented.tone).toBe("neutral");
    expect(STATUS_PRESENTATION.running.settled).toBe(false);
  });

  it("writes plain announcements", () => {
    expect(announceAgent({ name: "trials", status: "done", counts: { trials: 4 } })).toBe(
      "Clinical trials: finished, 4 trials.",
    );
    expect(summarizeSwarm(initialSwarm())).toBe("0 of 9 research agents finished, 0 searching now.");
    const final = buildSwarmSchedule().reduce(applySwarmEvent, initialSwarm());
    expect(summarizeSwarm(final)).toBe("All 7 research agents have finished. 2 not available yet.");
  });
});

describe("swarm simulation", () => {
  it("walks every agent to a terminal state within the run length", () => {
    const schedule = buildSwarmSchedule();
    const final = schedule.reduce(applySwarmEvent, initialSwarm());
    expect(final.every((a) => STATUS_PRESENTATION[a.status].settled)).toBe(true);
    expect(final.find((a) => a.name === "network")?.status).toBe("not_implemented");
    expect(final.some((a) => a.status === "failed")).toBe(true);
    expect(Math.max(...schedule.map((e) => e.at))).toBeLessThanOrEqual(SIMULATION_LENGTH_MS);
  });

  it("is time-ordered and applies events immutably", () => {
    const schedule = buildSwarmSchedule();
    expect(schedule.map((e) => e.at)).toEqual([...schedule.map((e) => e.at)].sort((a, b) => a - b));
    const start = initialSwarm();
    const next = applySwarmEvent(start, schedule[0]);
    expect(start.every((a) => a.status === "queued")).toBe(true);
    expect(next).not.toBe(start);
  });
});
