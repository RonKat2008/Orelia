import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  select: vi.fn(), consent: vi.fn(), draft: vi.fn(), approve: vi.fn(), taskApprove: vi.fn(), taskGet: vi.fn(),
}));
vi.mock("../../lib/outreach/server", () => ({
  getOutreachHandlers: () => ({ select: handlers.select, consent: handlers.consent, draft: handlers.draft, approve: handlers.approve }),
}));
vi.mock("../../lib/inbox/server", () => ({ getInboxHandlers: () => ({ approve: handlers.taskApprove, get: handlers.taskGet }) }));

import { MemoryOwnerStore, canAccess, getOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { GET as caseGet, PATCH as casePatch } from "../../app/api/cases/[id]/route";
import { POST as contactApprove } from "../../app/api/contacts/[id]/approve/route";
import { POST as taskApprove } from "../../app/api/tasks/[id]/approve/route";
import { POST as select } from "../../app/api/outreach/select/route";
import { getServices } from "../../app/api/cases/_lib/services";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const uuid = () => crypto.randomUUID();
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const saved: Record<string, string | undefined> = {};
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };

let store: MemoryOwnerStore;
beforeEach(() => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  Object.values(handlers).forEach((h) => h.mockReset().mockResolvedValue(Response.json({ ok: true })));
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
});

describe("canAccess", () => {
  it("owner only; unowned needs demo", () => {
    expect(canAccess("a", "a", {})).toBe(true);
    expect(canAccess("a", "b", {})).toBe(false);
    expect(canAccess("a", null, {})).toBe(false);
    expect(canAccess(undefined, "a", { WAYFINDER_DEMO: "1" })).toBe(false);
    expect(canAccess(null, "a", {})).toBe(false);
    expect(canAccess(null, null, { WAYFINDER_DEMO: "true" })).toBe(true);
    expect(canAccess(null, "a", { WAYFINDER_DEMO: "0" })).toBe(false);
  });
  it("getOwnerStore returns the memory singleton without DATABASE_URL", () => {
    expect(getOwnerStore()).toBe(store);
  });
});

describe("case routes", () => {
  it("GET: owner ok, other 404, no session 404, unowned 404 unless demo", async () => {
    const created = await getServices().cases.create({ diseaseName: "X", goals: [] } as never, "confirmed");
    store.registerCase(created.id, "owner");
    const get = (c?: string) =>
      caseGet(new Request(`${ORIGIN}/api/cases/${created.id}`, { headers: c ? { cookie: c } : {} }), ctx(created.id));
    expect((await get(cookie("owner"))).status).toBe(200);
    expect((await get(cookie("other"))).status).toBe(404);
    expect((await get()).status).toBe(404);
    store.registerCase(created.id, null);
    expect((await get(cookie("owner"))).status).toBe(404);
    process.env.WAYFINDER_DEMO = "1";
    expect((await get(cookie("owner"))).status).toBe(200);
  });
  it("PATCH: cross-origin 403 first, non-owner 404, owner passes", async () => {
    const created = await getServices().cases.create({ diseaseName: "X", goals: [] } as never, "draft");
    store.registerCase(created.id, "owner");
    const patch = (c: string, origin?: string) =>
      casePatch(
        new Request(`${ORIGIN}/api/cases/${created.id}`, {
          method: "PATCH",
          headers: { cookie: c, ...(origin ? { origin } : {}) },
          body: JSON.stringify({ fields: {} }),
        }),
        ctx(created.id),
      );
    expect((await patch(cookie("other"))).status).toBe(403);
    expect((await patch(cookie("owner"), "http://evil.test")).status).toBe(403);
    expect((await patch(cookie("other"), ORIGIN)).status).toBe(404);
    expect((await patch(cookie("owner"), ORIGIN)).status).not.toBe(404);
  });
});

describe("contact, task and select routes", () => {
  it("contacts/[id]/approve", async () => {
    const caseId = uuid();
    const contactId = uuid();
    store.registerCase(caseId, "owner");
    store.registerContact(contactId, caseId);
    const call = (c: string, origin?: string, id = contactId) =>
      contactApprove(
        new Request(`${ORIGIN}/x`, { method: "POST", headers: { cookie: c, ...(origin ? { origin } : {}) } }),
        ctx(id),
      );
    expect((await call(cookie("owner"))).status).toBe(403);
    expect((await call(cookie("other"), ORIGIN)).status).toBe(404);
    expect(handlers.approve).not.toHaveBeenCalled();
    expect((await call(cookie("owner"), ORIGIN)).status).toBe(200);
    expect(handlers.approve).toHaveBeenCalledWith(expect.any(Request), contactId);
    expect((await call(cookie("owner"), ORIGIN, uuid())).status).toBe(404);
  });
  it("tasks/[id]/approve", async () => {
    const caseId = uuid();
    const taskId = uuid();
    store.registerCase(caseId, "owner");
    store.registerTask(taskId, caseId);
    const call = (c: string, origin?: string) =>
      taskApprove(
        new Request(`${ORIGIN}/x`, { method: "POST", headers: { cookie: c, ...(origin ? { origin } : {}) } }),
        ctx(taskId),
      );
    expect((await call(cookie("owner"))).status).toBe(403);
    expect((await call(cookie("other"), ORIGIN)).status).toBe(404);
    expect(handlers.taskApprove).not.toHaveBeenCalled();
    expect((await call(cookie("owner"), ORIGIN)).status).toBe(200);
    expect(handlers.taskApprove).toHaveBeenCalledWith(expect.any(Request), taskId);
  });
  it("outreach/select", async () => {
    const caseId = uuid();
    store.registerCase(caseId, "owner");
    const body = JSON.stringify({ caseId, candidateIds: [uuid()] });
    const call = (c: string, origin?: string) =>
      select(
        new Request(`${ORIGIN}/api/outreach/select`, {
          method: "POST",
          headers: { cookie: c, ...(origin ? { origin } : {}) },
          body,
        }),
      );
    expect((await call(cookie("other"))).status).toBe(403);
    expect((await call(cookie("other"), ORIGIN)).status).toBe(404);
    expect(handlers.select).not.toHaveBeenCalled();
    expect((await call(cookie("owner"), ORIGIN)).status).toBe(200);
    const forwarded = handlers.select.mock.calls[0][0] as Request;
    expect(await forwarded.text()).toBe(body);
  });
});
