import { describe, expect, it } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { STUCK_AFTER_MS, reapIfStuck, sweepStuckResearch } from "@/lib/workflows/research-watchdog";

const T0 = new Date("2026-01-01T12:00:00.000Z");
const after = (ms: number) => () => new Date(T0.getTime() + ms);

async function stuckCase(status = "researching") {
  const cases = new MemoryCaseStore();
  const runs = new MemoryRunStore();
  const c = await cases.create({ diseaseName: "X", goals: [] }, status);
  const done = await runs.create(c.id, "literature");
  await runs.update(done, { status: "done", startedAt: T0, finishedAt: new Date(T0.getTime() + 1000) });
  const running = await runs.create(c.id, "trials");
  await runs.update(running, { status: "running", startedAt: T0 });
  const queued = await runs.create(c.id, "aid");
  return { cases, runs, c, running, queued };
}

describe("research watchdog (fake clock)", () => {
  it("leaves research alone while there was recent progress", async () => {
    const { cases, runs, c } = await stuckCase();
    expect(await reapIfStuck(c.id, { cases, runs, now: after(STUCK_AFTER_MS) })).toBe("active");
    expect((await cases.get(c.id))?.status).toBe("researching");
  });

  it("fails the case and every open run after 6 minutes of silence", async () => {
    const { cases, runs, c } = await stuckCase();
    expect(await reapIfStuck(c.id, { cases, runs, now: after(STUCK_AFTER_MS + 2000) })).toBe("reaped");
    expect((await cases.get(c.id))?.status).toBe("research_failed");
    const rows = await runs.listByCase(c.id);
    expect(rows.find((r) => r.agent === "literature")?.status).toBe("done");
    for (const agent of ["trials", "aid"]) {
      const row = rows.find((r) => r.agent === agent)!;
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/stopped responding/);
    }
  });

  it("is idempotent and never touches ready or already failed cases", async () => {
    const { cases, runs, c } = await stuckCase();
    const deps = { cases, runs, now: after(STUCK_AFTER_MS * 2) };
    expect(await reapIfStuck(c.id, deps)).toBe("reaped");
    expect(await reapIfStuck(c.id, deps)).toBe("not_researching");
    const ready = await stuckCase("ready");
    expect(await reapIfStuck(ready.c.id, { cases: ready.cases, runs: ready.runs, now: after(STUCK_AFTER_MS * 2) })).toBe("not_researching");
    expect((await ready.cases.get(ready.c.id))?.status).toBe("ready");
  });

  it("dates a case with no runs by its creation time", async () => {
    const cases = new MemoryCaseStore();
    const runs = new MemoryRunStore();
    const c = await cases.create({ diseaseName: "X", goals: [] }, "researching");
    const created = new Date(c.createdAt).getTime();
    expect(await reapIfStuck(c.id, { cases, runs, now: () => new Date(created + 1000) })).toBe("active");
    expect(await reapIfStuck(c.id, { cases, runs, now: () => new Date(created + STUCK_AFTER_MS + 1) })).toBe("reaped");
  });

  it("does not clobber a case that finished while checking", async () => {
    const { cases, runs, c } = await stuckCase();
    const racing = { ...cases, get: cases.get.bind(cases), compareAndSetStatus: async () => false } as unknown as MemoryCaseStore;
    expect(await reapIfStuck(c.id, { cases: racing, runs, now: after(STUCK_AFTER_MS * 2) })).toBe("raced");
    expect((await runs.listByCase(c.id)).find((r) => r.agent === "trials")?.status).toBe("running");
  });

  it("sweeps only the stuck ones and survives a failing case", async () => {
    const a = await stuckCase();
    const reaped = await sweepStuckResearch({
      cases: a.cases, runs: a.runs, now: after(STUCK_AFTER_MS * 2),
      listResearching: async () => ["missing", a.c.id],
    });
    expect(reaped).toEqual({ checked: 2, reaped: [a.c.id] });
  });
});
