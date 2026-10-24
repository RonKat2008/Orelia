import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  HOW_STEPS,
  PLAN_EXAMPLES,
  HERO_REASSURANCE,
  LANDING_PROMISES,
  PATIENT_STEP_COUNT,
  PROMISES,
  START_HREF,
} from "@/components/landing/content";
import {
  FINAL_FRAME,
  RUN_AGENTS,
  RUN_KEYFRAMES,
  RUN_TIMES,
  delayAfter,
  frameAt,
  nextKeyframe,
  panelLine,
} from "@/components/landing/run-script";

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

describe("hero card line", () => {
  it("moves from searching, to found, to plan ready as the run advances", () => {
    expect(panelLine(frameAt(0))).toBe("Looking in 5 places…");
    expect(panelLine(frameAt(4000))).toBe("Found 8 people and groups");
    expect(panelLine(FINAL_FRAME)).toBe("Plan ready: 3 to contact");
  });
});

describe("landing copy", () => {
  it("routes every start CTA to the intake flow", () => {
    expect(START_HREF).toBe("/start");
  });

  it("tells one four-step story, matching the patient progress line", () => {
    expect(HOW_STEPS.map((step) => step.title)).toEqual(["Tell us", "We search", "You choose", "We reach out"]);
    expect(PATIENT_STEP_COUNT).toBe(4);
    expect(PROMISES).toHaveLength(5);
    expect(PROMISES.some((promise) => /911/.test(promise.title + promise.body))).toBe(true);
  });

  it("shows three promises on the landing page and keeps patient copy free of jargon", () => {
    expect(LANDING_PROMISES).toHaveLength(3);
    const patientCopy = [HERO_REASSURANCE, ...HOW_STEPS.flatMap((s) => [s.title, s.body]), ...LANDING_PROMISES.flatMap((p) => [p.title, p.body])].join(" ");
    expect(patientCopy).not.toMatch(/\b(agents?|swarm|curator|verifier|allowlist|resource|score|rank|tier|pipeline)\b/i);
  });

  it("never phrases copy as medical advice", () => {
    const copy = [HERO_REASSURANCE, ...HOW_STEPS.flatMap((s) => [s.title, s.body, s.behind]), ...PROMISES.flatMap((p) => [p.body, p.more])].join(" ");
    expect(copy).not.toMatch(/\b(you should take|we recommend|diagnos(e|is) you|treatment plan)\b/i);
  });

  it("shows every channel, and at least one plan that combines channels", () => {
    expect(CHANNELS.map((channel) => channel.id)).toEqual(["call", "email", "web"]);
    const used = new Set(PLAN_EXAMPLES.flatMap((plan) => plan.channels));
    expect(used).toEqual(new Set(["call", "email", "web"]));
    expect(PLAN_EXAMPLES.some((plan) => plan.channels.length > 1)).toBe(true);
  });

  it("lists what we never do, including that the demo only reaches test inboxes", () => {
    const titles = PROMISES.map((promise) => promise.title).join(" ");
    expect(titles).toMatch(/medical advice/i);
    expect(titles).toMatch(/approve/i);
    expect(titles).toMatch(/detail/i);
    expect(titles).toMatch(/test inboxes/i);
  });
});
