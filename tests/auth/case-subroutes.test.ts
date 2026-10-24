import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const docs = vi.hoisted(() => ({ list: vi.fn(async () => []), ingest: vi.fn(async () => []) }));
vi.mock("../../lib/case-docs", () => ({ getDocumentStore: () => ({ list: docs.list }), ingest: docs.ingest }));

import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { GET as shortlistGet } from "../../app/api/cases/[id]/shortlist/route";
import { GET as docsGet, POST as docsPost } from "../../app/api/cases/[id]/documents/route";
import { getServices } from "../../app/api/cases/_lib/services";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const saved: Record<string, string | undefined> = {};
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };

let store: MemoryOwnerStore;
let caseId: string;
beforeEach(async () => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  caseId = (await getServices().cases.create({ diseaseName: "X", goals: [] } as never, "ready")).id;
  store.registerCase(caseId, "owner");
  docs.list.mockClear(); docs.ingest.mockClear();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
});

describe("case sub-routes enforce ownership", () => {
  it("shortlist GET: owner 200, other session 404", async () => {
    const get = (c: string) => shortlistGet(new Request(`${ORIGIN}/api/cases/${caseId}/shortlist`, { headers: { cookie: c } }), ctx(caseId));
    expect((await get(cookie("owner"))).status).toBe(200);
    expect((await get(cookie("other"))).status).toBe(404);
  });
  it("documents GET: other session 404 without touching the store", async () => {
    const res = await docsGet(new Request(`${ORIGIN}/api/cases/${caseId}/documents`, { headers: { cookie: cookie("other") } }), ctx(caseId));
    expect(res.status).toBe(404);
    expect(docs.list).not.toHaveBeenCalled();
  });
  it("documents POST: cross-origin 403 and non-owner 404 before ingest", async () => {
    const post = (headers: Record<string, string>) => docsPost(new Request(`${ORIGIN}/api/cases/${caseId}/documents`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ title: "Note", text: "Synthetic note text." }),
    }), ctx(caseId));
    expect((await post({ origin: "https://evil.example.net", cookie: cookie("owner") })).status).toBe(403);
    expect((await post({ origin: ORIGIN, cookie: cookie("other") })).status).toBe(404);
    expect(docs.ingest).not.toHaveBeenCalled();
  });
});
