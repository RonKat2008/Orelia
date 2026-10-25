import { describe, expect, it, vi } from "vitest";
import { restartResearch } from "@/components/swarm/useSwarmStream";
import { GET as streamResearch } from "@/app/api/cases/[id]/stream/route";

const services = vi.hoisted(() => ({ getCase: vi.fn(), listRuns: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireCaseOwner: async () => ({ ok: true }) }));
vi.mock("@/lib/workflows/research-watchdog", () => ({ reapIfStuck: async () => "active" }));
vi.mock("@/app/api/cases/_lib/services", () => ({
  getServices: () => ({ cases: { get: services.getCase }, runs: { listByCase: services.listRuns } }),
}));

describe("research restart acceptance", () => {
  it("accepts a queued restart", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(restartResearch("case", f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith("/api/cases/case/research", { method: "POST" });
  });

  it.each([[429, /wait a little/], [404, /no longer available/], [503, /Could not restart/]])(
    "rejects HTTP %i before clearing progress", async (status, message) => {
      const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      await expect(restartResearch("case", f)).rejects.toThrow(message);
    },
  );

  it("attaches after a conflict only when a running attempt is verified", async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ caseStatus: "researching" }));
    await expect(restartResearch("case", f)).resolves.toBeUndefined();
    expect(f).toHaveBeenLastCalledWith("/api/cases/case/status", { cache: "no-store" });
  });

  it("does not treat an unconfirmed-case conflict as a running search", async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ caseStatus: "draft" }));
    await expect(restartResearch("case", f)).rejects.toThrow("Refresh the page");
  });

  it("reports network failure without exposing transport details", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error("private upstream detail"));
    await expect(restartResearch("case", f)).rejects.toThrow("Check your connection");
  });
});

describe("research stream lifecycle", () => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  const context = () => ({ params: Promise.resolve({ id: caseId }) });
  const url = `http://localhost/api/cases/${caseId}/stream`;

  it("finishes persisted failure even if the attempt never queued any agents", async () => {
    services.getCase.mockReset().mockResolvedValue({ status: "research_failed" });
    services.listRuns.mockReset().mockResolvedValue([]);
    const response = await streamResearch(new Request(url), context());
    expect(await response.text()).toContain('event: done\ndata: {"caseId":"' + caseId + '","caseStatus":"research_failed"}');
    expect(services.listRuns).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue or close again after reader cancellation during a database read", async () => {
    let finishRead!: (value: { status: string }) => void;
    services.getCase.mockReset().mockResolvedValueOnce({ status: "researching" })
      .mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    services.listRuns.mockReset().mockResolvedValue([]);
    const response = await streamResearch(new Request(url), context());
    const reader = response.body!.getReader();
    // The watchdog is asynchronous; allow the first progress read to start.
    await vi.waitFor(() => expect(services.getCase).toHaveBeenCalledTimes(2));
    await reader.cancel();
    finishRead({ status: "researching" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(services.listRuns).toHaveBeenCalledTimes(1);
  });

  it("wakes a sleeping poll and closes on request abort", async () => {
    services.getCase.mockReset().mockResolvedValue({ status: "researching" });
    services.listRuns.mockReset().mockResolvedValue([]);
    const abort = new AbortController();
    const response = await streamResearch(new Request(url, { signal: abort.signal }), context());
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    abort.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(services.listRuns).toHaveBeenCalledTimes(1);
  });
});
