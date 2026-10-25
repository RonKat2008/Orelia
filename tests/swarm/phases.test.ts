import { describe, expect, it } from "vitest";
import { INITIAL, swarmReducer } from "@/components/swarm/useSwarmStream";
import { activePhaseTimer, derivePhase, formatElapsed, initialAgents, narrate, parseRunsSnapshot } from "@/components/swarm/stream";
import { AGENT_NAMES } from "@/components/swarm/stream";

const T0 = "2026-01-01T00:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const agentRows = AGENT_NAMES.map((agent) => ({ agent, status: "done", startedAt: at(0), finishedAt: at(10) }));
const snapshot = (rows: unknown[], caseStatus = "researching", serverTime = at(40)) =>
  JSON.stringify({ caseStatus, runs: [...agentRows, ...rows], serverTime });

describe("post-search phases", () => {
  it("parses verifier, ranker and curator rows into phases", () => {
    const s = parseRunsSnapshot(snapshot([{ agent: "verifier", status: "done", startedAt: at(11), finishedAt: at(40) }, { agent: "ranker", status: "running", startedAt: at(41) }]))!;
    expect(s.phases.verify?.status).toBe("done");
    expect(s.phases.rank?.status).toBe("running");
    expect(s.cards).toHaveLength(12);
  });

  it("advances the stepper verify -> rank -> curate -> ready", () => {
    const cards = (rows: unknown[]) => parseRunsSnapshot(snapshot(rows))!;
    const a = cards([{ agent: "verifier", status: "running", startedAt: at(11) }]);
    expect(derivePhase(a.cards, "researching", a.phases)).toBe(1);
    const b = cards([{ agent: "verifier", status: "done" }, { agent: "ranker", status: "running" }]);
    expect(derivePhase(b.cards, "researching", b.phases)).toBe(2);
    const c = cards([{ agent: "verifier", status: "done" }, { agent: "ranker", status: "done" }, { agent: "curator", status: "running" }]);
    expect(derivePhase(c.cards, "researching", c.phases)).toBe(3);
    expect(derivePhase(c.cards, "ready", c.phases)).toBe(4);
  });

  it("times the active phase from its start, falling back to when the previous stage finished", () => {
    const running = parseRunsSnapshot(snapshot([{ agent: "verifier", status: "done", finishedAt: at(40) }, { agent: "ranker", status: "running", startedAt: at(41) }]))!;
    expect(activePhaseTimer(running.cards, "researching", running.phases)).toMatchObject({ phase: "rank", label: "Ranking what fits", startedAtMs: Date.parse(at(41)) });
    const gap = parseRunsSnapshot(snapshot([{ agent: "verifier", status: "done", finishedAt: at(40) }]))!;
    expect(activePhaseTimer(gap.cards, "researching", gap.phases)?.startedAtMs).toBe(Date.parse(at(40)));
    const searching = initialAgents();
    expect(activePhaseTimer(searching, "researching", {})).toBeNull();
    expect(activePhaseTimer(running.cards, "ready", running.phases)).toBeNull();
  });

  it("narrates the active stage", () => {
    const s = parseRunsSnapshot(snapshot([{ agent: "verifier", status: "done" }, { agent: "ranker", status: "running" }]))!;
    expect(narrate(s.cards, "researching", undefined, s.phases)).toMatch(/Ranking what fits/);
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(34_000)).toBe("0:34");
    expect(formatElapsed(65_900)).toBe("1:05");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("reducer keeps phases, tracks the server clock offset and does not force 'live'", () => {
    const next = swarmReducer({ ...INITIAL, connection: "polling" }, { type: "runs", data: snapshot([{ agent: "ranker", status: "running", startedAt: at(41) }], "researching", at(50)), clientNow: Date.parse(at(48)) });
    expect(next.phases.rank?.status).toBe("running");
    expect(next.clockOffsetMs).toBe(2000);
    expect(next.connection).toBe("polling");
  });
});
