import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const builder = vi.hoisted(() => ({ buildConditionBrief: vi.fn() }));
vi.mock("@/lib/condition-brief/build", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/condition-brief/build")>()),
  buildConditionBrief: builder.buildConditionBrief,
}));

import { getServices } from "@/app/api/cases/_lib/services";
import { GET, POST } from "@/app/api/cases/[id]/condition-brief/route";
import { MemoryOwnerStore } from "@/lib/auth/ownership";
import { signSession } from "@/lib/auth/session";
import { ConditionBriefUnavailableError } from "@/lib/condition-brief/build";
import { MemoryConditionBriefStore, setConditionBriefStoreForTests } from "@/lib/condition-brief/store";
import { makeBrief } from "./brief-fixture";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const cookie = (who: string) => `wf_session=${signSession(who, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderServices?: unknown };
const saved: Record<string, string | undefined> = {};

let caseId: string;
let briefs: MemoryConditionBriefStore;

const call = (fn: typeof GET | typeof POST, o: { method?: string; who?: string; origin?: string | null; body?: unknown; id?: string } = {}) => {
  const id = o.id ?? caseId;
  const origin = o.origin === undefined ? (o.method === "POST" ? ORIGIN : undefined) : o.origin ?? undefined;
  return fn(new Request(`${ORIGIN}/api/cases/${id}/condition-brief`, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", cookie: cookie(o.who ?? "owner"), ...(origin ? { origin } : {}) },
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  }), { params: Promise.resolve({ id }) });
};
const post = (o: Parameters<typeof call>[1] = {}) => call(POST, { method: "POST", body: {}, ...o });

beforeEach(async () => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  delete holder.__wayfinderServices;
  delete (globalThis as { __rateLimitStore?: unknown }).__rateLimitStore;
  const owners = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = owners;
  caseId = (await getServices().cases.create({ diseaseName: "Vascular Ehlers-Danlos syndrome", goals: [] } as never, "ready")).id;
  owners.registerCase(caseId, "owner");
  briefs = new MemoryConditionBriefStore();
  setConditionBriefStoreForTests(briefs);
  builder.buildConditionBrief.mockReset().mockImplementation(async (id: string, _name: string, deps: { store: MemoryConditionBriefStore }) => {
    const prev = await deps.store.latest(id);
    return makeBrief(id, { version: (prev?.version ?? 0) + 1 });
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderServices;
  setConditionBriefStoreForTests(undefined);
});

describe("condition-brief route: guards", () => {
  it("rejects invalid ids, non-owners and cross-origin POSTs without building", async () => {
    expect((await call(GET, { id: "not-a-uuid" })).status).toBe(400);
    expect((await call(GET, { who: "other" })).status).toBe(404);
    expect((await post({ who: "other" })).status).toBe(404);
    expect((await post({ origin: "https://evil.example.net" })).status).toBe(403);
    expect(builder.buildConditionBrief).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const res = await post({ body: { refresh: "yes" } });
    expect(res.status).toBe(400);
    expect(builder.buildConditionBrief).not.toHaveBeenCalled();
  });
});

describe("condition-brief route: GET/POST", () => {
  it("GET is 404 before any brief, then returns the cached brief", async () => {
    expect((await call(GET)).status).toBe(404);
    await briefs.save(makeBrief(caseId));
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect((await res.json()).brief.caseId).toBe(caseId);
  });

  it("POST builds and saves when none exists (201), then returns the cache (200)", async () => {
    const first = await post();
    expect(first.status).toBe(201);
    expect((await first.json()).brief.version).toBe(1);
    expect(builder.buildConditionBrief).toHaveBeenCalledWith(caseId, "Vascular Ehlers-Danlos syndrome", expect.objectContaining({ store: briefs }));
    expect((await briefs.latest(caseId))?.version).toBe(1);
    const second = await post();
    expect(second.status).toBe(200);
    expect(builder.buildConditionBrief).toHaveBeenCalledTimes(1);
  });

  it("POST {refresh:true} rebuilds with the next version", async () => {
    await briefs.save(makeBrief(caseId, { version: 3 }));
    const res = await post({ body: { refresh: true } });
    expect(res.status).toBe(201);
    expect((await res.json()).brief.version).toBe(4);
    expect((await briefs.latest(caseId))?.version).toBe(4);
  });

  it("dedupes concurrent rebuilds for the same case", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    builder.buildConditionBrief.mockImplementation(async (id: string) => { await gate; return makeBrief(id); });
    const a = post({ body: { refresh: true } });
    const b = post({ body: { refresh: true } });
    await new Promise(r => setTimeout(r, 20));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(builder.buildConditionBrief).toHaveBeenCalledTimes(1);
  });

  it("maps an unavailable offline condition to 422 and other failures to a generic 500", async () => {
    builder.buildConditionBrief.mockRejectedValueOnce(new ConditionBriefUnavailableError("Offline mode only has demo briefs"));
    const r422 = await post();
    expect(r422.status).toBe(422);
    expect((await r422.json()).error).toMatch(/Offline/);
    builder.buildConditionBrief.mockRejectedValueOnce(new Error("internal secret detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r500 = await post();
    expect(r500.status).toBe(500);
    expect(JSON.stringify(await r500.json())).not.toContain("secret");
    expect(await briefs.latest(caseId)).toBeNull();
  });
});

describe("condition-brief route: rate limit", () => {
  it("caps rebuilds per case and returns 429 with Retry-After", async () => {
    for (let i = 0; i < 6; i++) expect((await post({ body: { refresh: true } })).status).toBe(201);
    const limited = await post({ body: { refresh: true } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(builder.buildConditionBrief).toHaveBeenCalledTimes(6);
  });

  it("does not count cached reads against the limit", async () => {
    expect((await post()).status).toBe(201);
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(200);
  });
});
