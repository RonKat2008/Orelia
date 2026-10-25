import { describe, expect, it } from "vitest";
import { stageRows, summaryLine } from "@/components/swarm/overview";
import { initialAgents, type AgentCardState } from "@/components/swarm/stream";

const withStatus = (status: AgentCardState["status"], counts?: Record<string, number>): AgentCardState[] =>
  initialAgents().map((card) => ({ ...card, status, counts }));

describe("summaryLine", () => {
  it("counts running agents, done and sources", () => {
    const cards = withStatus("running");
    cards[0] = { ...cards[0], status: "done", counts: { records: 4, evidence: 9 } };
    const available = cards.filter((c) => c.status !== "not_implemented").length;
    expect(summaryLine(cards)).toBe(`${available} agents searching · 1 done · 9 sources`);
  });
  it("switches to finished wording with kept records", () => {
    const cards = withStatus("done", { records: 2, evidence: 3 });
    const n = cards.length;
    expect(summaryLine(cards)).toBe(`${n} agents finished · ${n * 3} sources · ${n * 2} kept`);
  });
  it("treats a ready run as finished and hides agents that never ran", () => {
    const cards = withStatus("done", { records: 1, evidence: 2 });
    cards[0] = { ...cards[0], status: "queued", counts: undefined };
    const n = cards.length - 1;
    expect(summaryLine(cards, true)).toBe(`${n} agents finished · ${n * 2} sources · ${n} kept`);
  });
  it("ignores not-available agents", () => {
    const cards = withStatus("done");
    cards[0] = { ...cards[0], status: "not_implemented" };
    expect(summaryLine(cards)).toContain(`${cards.length - 1} agents finished`);
  });
});

describe("stageRows", () => {
  it("keeps both stages pending while searching", () => {
    const rows = stageRows(withStatus("running"), undefined, {});
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending"]);
  });
  it("lights validate once searches settle, judge after verification", () => {
    const cards = withStatus("done");
    expect(stageRows(cards, undefined, {}).map((r) => r.state)).toEqual(["running", "pending"]);
    expect(stageRows(cards, undefined, { verify: { status: "done" } }).map((r) => r.state)).toEqual(["done", "running"]);
  });
  it("completes both when ready and marks failure when stopped", () => {
    expect(stageRows(withStatus("done"), "ready", {}).map((r) => r.state)).toEqual(["done", "done"]);
    expect(stageRows(withStatus("running"), "research_failed", {}).map((r) => r.state)).toEqual(["failed", "failed"]);
  });
  it("surfaces the needs summary while the judge waits", () => {
    const rows = stageRows(withStatus("running"), undefined, { needs: { status: "done", summary: "4 specialties" } });
    expect(rows[1].detail).toBe("4 specialties");
  });
});
