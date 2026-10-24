import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortlistItem } from "@/lib/agents/persist";
import type { StoredCuration } from "@/lib/agents/curator-store";

// Ownership/CSRF are covered in tests/auth; these tests exercise the route body.
const guard = vi.hoisted(() => ({ guardCase: vi.fn(async (...args: [Request, string]): Promise<Response | null> => (void args, null)) }));
vi.mock("@/lib/auth/ownership", () => ({ guardCase: guard.guardCase }));

const state = vi.hoisted(() => ({ items: [] as unknown[], curation: null as unknown }));

vi.mock("@/app/api/cases/_lib/services", () => ({
  getServices: () => ({
    cases: { get: async (id: string) => ({ id, status: "ready" }) },
    persist: { getShortlist: async () => state.items },
  }),
}));
vi.mock("@/lib/agents/curator-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/curator-store")>()),
  getCurationStore: () => ({ load: async () => state.curation, save: async () => {} }),
}));

import { GET } from "@/app/api/cases/[id]/shortlist/route";

const ID = "11111111-1111-4111-8111-111111111111";
const item = (kind: ShortlistItem["targetKind"], id: string, rank: number): ShortlistItem => ({
  targetKind: kind, targetId: id, name: `N-${id}`, rank, score: 50, selected: false, breakdown: [], evidence: [],
});
const call = async () => (await GET(new Request("http://x"), { params: Promise.resolve({ id: ID }) })).json();

describe("GET shortlist with curation", () => {
  it("calls the ownership guard", async () => {
    await call();
    expect(guard.guardCase).toHaveBeenCalledWith(expect.any(Request), ID);
  });

  beforeEach(() => {
    state.items = Array.from({ length: 8 }, (_, i) => item("expert", `e${i}`, i + 1));
    state.curation = null;
  });

  it("defaults to backup / [] / null / [] when no curation exists", async () => {
    const body = await call();
    expect(body.curationSummary).toBeNull();
    expect(body.suggested).toEqual([]);
    expect(body.groups.expert).toHaveLength(8);
    expect(body.groups.expert[0]).toMatchObject({ tier: "backup", tierReasons: [], rank: 1, name: "N-e0" });
  });

  it("returns tier, tierReasons, summary and best-only suggested capped at 5", async () => {
    const byTarget: StoredCuration["byTarget"] = new Map();
    for (let i = 0; i < 8; i++) byTarget.set(`expert:e${i}`, { tier: i < 7 ? "best" : "good", tierReasons: [{ text: `r${i}`, evidenceIds: [] }] });
    state.curation = {
      byTarget,
      summary: "Summary.",
      // includes a non-best and an unknown key, both of which must be dropped
      suggested: ["expert:e0", "expert:e1", "expert:e7", "expert:nope", "expert:e2", "expert:e3", "expert:e4", "expert:e5"],
    } satisfies StoredCuration;
    const body = await call();
    expect(body.curationSummary).toBe("Summary.");
    expect(body.groups.expert[0]).toMatchObject({ tier: "best", tierReasons: [{ text: "r0", evidenceIds: [] }] });
    expect(body.groups.expert[7].tier).toBe("good");
    expect(body.suggested).toHaveLength(5);
    expect(body.suggested[0]).toEqual({ targetKind: "expert", targetId: "e0", name: "N-e0" });
    expect(body.suggested.map((s: { targetId: string }) => s.targetId)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });
});
