import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  HOW_STEPS,
  PLAN_EXAMPLES,
  PROMISES,
  START_HREF,
  TRUST_LINE,
} from "@/components/landing/content";
import {
  DESKTOP_LAYOUT,
  MOBILE_LAYOUT,
  buildPoster,
  createRandom,
  layoutForWidth,
  makePathSeeds,
  pathPoint,
  targetInField,
} from "@/components/landing/field/geometry";
import {
  FINAL_FRAME,
  RUN_AGENTS,
  RUN_KEYFRAMES,
  RUN_TIMES,
  delayAfter,
  frameAt,
  nextKeyframe,
} from "@/components/landing/run-script";

describe("landing field geometry", () => {
  it("is deterministic for a given seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(makePathSeeds(5)).toEqual(makePathSeeds(5));
  });

  it("starts every path away from the target and ends exactly on it", () => {
    const aspect = 1.6;
    const target = targetInField(DESKTOP_LAYOUT, aspect);
    for (const seed of makePathSeeds(50)) {
      const start = pathPoint(seed, 0, target, aspect);
      const end = pathPoint(seed, 1, target, aspect);
      expect(Math.hypot(start.x - target.x, start.y - target.y)).toBeGreaterThan(1);
      expect(end.x).toBeCloseTo(target.x, 6);
      expect(end.y).toBeCloseTo(target.y, 6);
    }
  });

  it("picks the layout by width and maps the target into field space", () => {
    expect(layoutForWidth(1440)).toBe(DESKTOP_LAYOUT);
    expect(layoutForWidth(375)).toBe(MOBILE_LAYOUT);
    expect(targetInField({ targetX: 0.5, targetY: 0.5 }, 2)).toEqual({ x: 0, y: 0 });
  });

  it("builds a poster with the requested paths and contours", () => {
    const poster = buildPoster(DESKTOP_LAYOUT, 1.7, 12, 4);
    expect(poster.paths).toHaveLength(12);
    expect(poster.contours).toHaveLength(4);
    expect(poster.paths[0]).toMatch(/^M[\d.-]+ [\d.-]+L/);
    expect(poster.contours.every((d) => d.endsWith("Z"))).toBe(true);
    expect(Math.abs(poster.target.x - 0.535 * poster.width)).toBeLessThanOrEqual(1);
  });
});

describe("illustrative agent run script", () => {
  it("starts with every agent waiting and nothing curated", () => {
    const frame = frameAt(0);
    expect(frame.agents.every((agent) => agent.status === "waiting")).toBe(true);
    expect(frame.visibleSources).toBe(0);
    expect(frame.curated).toBe(false);
    expect(frame.drafted).toBe(false);
  });

  it("finishes with every agent done, a best fit and a draft waiting for approval", () => {
    expect(FINAL_FRAME.doneCount).toBe(RUN_AGENTS.length);
    expect(FINAL_FRAME.curated).toBe(true);
    expect(FINAL_FRAME.drafted).toBe(true);
    expect(FINAL_FRAME.caption).toMatch(/approval/i);
  });

  it("only curates after every agent is done, and drafts after curating", () => {
    const lastDone = Math.max(...RUN_AGENTS.map((agent) => agent.doneAt));
    expect(RUN_TIMES.curated).toBeGreaterThan(lastDone);
    expect(RUN_TIMES.drafted).toBeGreaterThan(RUN_TIMES.curated);
  });

  it("has ascending keyframes with positive delays that sum to one loop", () => {
    const sorted = [...RUN_KEYFRAMES].sort((a, b) => a - b);
    expect(RUN_KEYFRAMES).toEqual(sorted);
    const delays = RUN_KEYFRAMES.map((_, i) => delayAfter(i));
    expect(delays.every((delay) => delay > 0)).toBe(true);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(RUN_TIMES.end);
    expect(nextKeyframe(RUN_KEYFRAMES.length - 1)).toBe(0);
  });

  it("loops for longer than five seconds (so the hero must offer a pause control)", () => {
    expect(RUN_TIMES.end).toBeGreaterThan(5000);
  });
});

describe("landing copy", () => {
  it("routes every start CTA to the intake flow", () => {
    expect(START_HREF).toBe("/start");
  });

  it("tells the five-step story and the five promises", () => {
    expect(HOW_STEPS.map((step) => step.kicker)).toEqual([
      "Your details",
      "Agent swarm",
      "Validation",
      "A plan per resource",
      "Outreach & follow-up",
    ]);
    expect(PROMISES).toHaveLength(5);
    expect(PROMISES.some((promise) => /911/.test(promise.title + promise.body))).toBe(true);
  });

  it("never phrases copy as medical advice", () => {
    const copy = [...TRUST_LINE, ...HOW_STEPS.flatMap((s) => [s.title, s.body]), ...PROMISES.map((p) => p.body)].join(" ");
    expect(copy).not.toMatch(/\b(you should take|we recommend|diagnos(e|is) you|treatment plan)\b/i);
  });

  it("shows every channel, and at least one plan that combines channels", () => {
    expect(CHANNELS.map((channel) => channel.id)).toEqual(["call", "email", "web"]);
    const used = new Set(PLAN_EXAMPLES.flatMap((plan) => plan.channels));
    expect(used).toEqual(new Set(["call", "email", "web"]));
    expect(PLAN_EXAMPLES.some((plan) => plan.channels.length > 1)).toBe(true);
  });

  it("lists what we never do, including the demo allowlist", () => {
    const titles = PROMISES.map((promise) => promise.title).join(" ");
    expect(titles).toMatch(/medical advice/i);
    expect(titles).toMatch(/approve/i);
    expect(titles).toMatch(/field/i);
    expect(titles).toMatch(/allowlist/i);
  });
});
