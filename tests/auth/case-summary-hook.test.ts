import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const docs = vi.hoisted(() => ({ ingestCaseSummary: vi.fn(async (record: { id: string }) => (void record, [])) }));
vi.mock("@/lib/case-docs", () => ({ ingestCaseSummary: docs.ingestCaseSummary }));

import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { PATCH } from "../../app/api/cases/[id]/route";
import { getServices } from "../../app/api/cases/_lib/services";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const saved: Record<string, string | undefined> = {};
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };

let caseId: string;
const patch = () => PATCH(new Request(`${ORIGIN}/api/cases/${caseId}`, {
  method: "PATCH",
  headers: { origin: ORIGIN, "content-type": "application/json", cookie: `wf_session=${signSession("owner", { WAYFINDER_SESSION_SECRET: SECRET })}` },
  body: JSON.stringify({ fields: {} }),
}), { params: Promise.resolve({ id: caseId }) });

beforeEach(async () => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.DATABASE_URL;
  const store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  caseId = (await getServices().cases.create({ diseaseName: "synthetic", goals: [] } as never, "draft")).id;
  store.registerCase(caseId, "owner");
  docs.ingestCaseSummary.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
});

describe("case summary ingest on confirm", () => {
  it("ingests the confirmed case", async () => {
    expect((await patch()).status).toBe(200);
    expect(docs.ingestCaseSummary).toHaveBeenCalledWith(expect.objectContaining({ id: caseId, status: "confirmed" }));
  });
  it("never fails the request when ingest throws", async () => {
    docs.ingestCaseSummary.mockRejectedValueOnce(new Error("embedding down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await patch()).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
