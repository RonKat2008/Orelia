import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/case-docs", () => ({ ingestCaseSummary: vi.fn(async () => []) }));

import { extractCase, confirmAndResearch, rememberCase, recallCase } from "@/components/intake/case-client";
import { PATCH } from "@/app/api/cases/[id]/route";
import { getServices } from "@/app/api/cases/_lib/services";
import { MemoryOwnerStore } from "@/lib/auth/ownership";
import { signSession } from "@/lib/auth/session";
import type { Case } from "@/lib/contracts";

const record: Case = {
  id: "8c3c9c40-66e3-4bee-8db6-2c947485ac29", status: "draft", createdAt: "2026-10-24T00:00:00.000Z",
  diseaseName: "Synthetic condition", homeCity: "Tucson", insurer: "Sample insurer", travelLimitMiles: 600, goals: ["trial"],
};
const holder = globalThis as typeof globalThis & { __wayfinderOwnerStore?: MemoryOwnerStore; __wayfinderServices?: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_WAYFINDER_OFFLINE", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("WAYFINDER_SESSION_SECRET", "intake-test-secret");
  delete holder.__wayfinderServices;
  holder.__wayfinderOwnerStore = new MemoryOwnerStore();
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(() => null) });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete holder.__wayfinderServices;
  delete holder.__wayfinderOwnerStore;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("intake API handoff", () => {
  it("persists corrected details and explicit removals before research starts", async () => {
    const stored = await getServices().cases.create(record, "draft");
    holder.__wayfinderOwnerStore!.registerCase(stored.id, "owner");
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (init.method === "PATCH") {
        const request = new Request(`http://localhost${url}`, {
          ...init,
          headers: { ...init.headers, origin: "http://localhost", cookie: `wf_session=${signSession("owner")}` },
        });
        return PATCH(request, { params: Promise.resolve({ id: stored.id }) });
      }
      const saved = await getServices().cases.get(stored.id);
      expect(saved).toMatchObject({ diseaseName: "Corrected condition", homeCity: "Boston", goals: ["support"], status: "confirmed" });
      expect(saved?.insurer).toBeUndefined();
      expect(saved?.travelLimitMiles).toBeUndefined();
      return Response.json({ status: "researching" }, { status: 202 });
    });
    await confirmAndResearch({ ...stored, diseaseName: "Corrected condition", homeCity: "Boston", insurer: undefined, travelLimitMiles: undefined, goals: ["support"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ fields: { insurer: null, travelLimitMiles: null } });
  });

  it("rejects an incorrectly wrapped PATCH instead of silently ignoring edits", async () => {
    const stored = await getServices().cases.create(record, "draft");
    holder.__wayfinderOwnerStore!.registerCase(stored.id, "owner");
    const response = await PATCH(new Request(`http://localhost/api/cases/${stored.id}`, {
      method: "PATCH", headers: { origin: "http://localhost", cookie: `wf_session=${signSession("owner")}`, "content-type": "application/json" },
      body: JSON.stringify({ diseaseName: "Ignored edit" }),
    }), { params: Promise.resolve({ id: stored.id }) });
    expect(response.status).toBe(400);
    expect((await getServices().cases.get(stored.id))?.status).toBe("draft");
  });

  it("does not start research when saving fails", async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 500 }));
    await expect(confirmAndResearch(record)).rejects.toThrow("details could not be saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("distinguishes research failures from unsaved details", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ case: record })).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(confirmAndResearch(record)).rejects.toThrow("details were saved, but research could not start");
  });

  it("resumes research already started after a previous response was lost", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 409 })).mockResolvedValueOnce(Response.json({ case: { ...record, status: "researching" } }));
    await expect(confirmAndResearch(record)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows how long to wait after a research rate limit", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ case: record })).mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "42" } }));
    await expect(confirmAndResearch(record)).rejects.toThrow("42 seconds");
  });
});

describe("intake storage and extraction", () => {
  it("continues with a valid server case when browser storage is blocked", async () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("blocked"); }, getItem: () => { throw new Error("blocked"); } });
    fetchMock.mockResolvedValue(Response.json({ case: record }, { status: 201 }));
    await expect(extractCase("A synthetic report for a condition", record)).resolves.toEqual({ record, preview: false });
    expect(() => rememberCase(record)).not.toThrow();
    expect(recallCase(record.id)).toBeNull();
  });

  it("ignores malformed cached cases", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "{invalid" });
    expect(recallCase(record.id)).toBeNull();
  });

  it("does not invent a case ID when the server response is incomplete", async () => {
    fetchMock.mockResolvedValue(Response.json({ case: { diseaseName: "Synthetic condition" } }));
    await expect(extractCase("A synthetic report for a condition", record)).rejects.toThrow("incomplete case");
  });

  it("rejects invalid report lengths without sending a request", async () => {
    await expect(extractCase("short", record)).rejects.toThrow();
    await expect(extractCase("x".repeat(60_001), record)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
