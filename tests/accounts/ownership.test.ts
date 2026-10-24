import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryOwnerStore, canAccessCase, guardCase, requireCaseOwner } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { HeaderAccountResolver, setAccountResolverForTests } from "../../lib/accounts/current";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
function req(opts: { session?: string; account?: string; method?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (opts.session) headers.cookie = cookie(opts.session);
  if (opts.account) headers["x-test-account"] = opts.account;
  return new Request(`${ORIGIN}/api/cases/x`, { method: opts.method ?? "GET", headers });
}

let store: MemoryOwnerStore;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  setAccountResolverForTests(new HeaderAccountResolver());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
  setAccountResolverForTests(undefined);
});

describe("canAccessCase", () => {
  it("account-owned case: the account, or the legacy session while signed out", () => {
    const c = { owner: "s1", caseAccount: "A" };
    expect(canAccessCase({ ...c, sessionId: null, accountId: "A" }, {})).toBe(true);
    expect(canAccessCase({ ...c, sessionId: "s1", accountId: null }, {})).toBe(true);
    expect(canAccessCase({ ...c, sessionId: "s1", accountId: "B" }, {})).toBe(false);
    expect(canAccessCase({ ...c, sessionId: null, accountId: "B" }, {})).toBe(false);
    expect(canAccessCase({ ...c, sessionId: "s2", accountId: null }, {})).toBe(false);
  });
  it("anonymous case keeps the session rule and the demo rule", () => {
    expect(canAccessCase({ owner: "s1", caseAccount: null, sessionId: "s1", accountId: null }, {})).toBe(true);
    expect(canAccessCase({ owner: "s1", caseAccount: null, sessionId: "s2", accountId: "A" }, {})).toBe(false);
    expect(canAccessCase({ owner: null, caseAccount: null, sessionId: null, accountId: null }, { WAYFINDER_DEMO: "1" })).toBe(true);
    expect(canAccessCase({ owner: undefined, caseAccount: null, sessionId: "s1", accountId: "A" }, { WAYFINDER_DEMO: "1" })).toBe(false);
  });
});

describe("route guards with accounts", () => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  it("lets the owning account in from any browser and returns its id", async () => {
    store.registerCase(caseId, "s1", "A");
    const r = await requireCaseOwner(req({ account: "A" }), caseId);
    expect(r.ok && r.accountId).toBe("A");
  });
  it("404s another account even with the legacy session cookie (IDOR)", async () => {
    store.registerCase(caseId, "s1", "A");
    const denied = await guardCase(req({ account: "B", session: "s1" }), caseId);
    expect(denied?.status).toBe(404);
    expect((await guardCase(req({ account: "B" }), caseId))?.status).toBe(404);
  });
  it("legacy anonymous owner still works when signed out", async () => {
    store.registerCase(caseId, "s1", "A");
    expect(await guardCase(req({ session: "s1" }), caseId)).toBeNull();
    store.registerCase(caseId, "s9");
    expect(await guardCase(req({ session: "s9" }), caseId)).toBeNull();
  });
  it("keeps CSRF first for state-changing methods", async () => {
    store.registerCase(caseId, "s1", "A");
    const bad = new Request(`${ORIGIN}/api/cases/x`, { method: "POST", headers: { origin: "https://evil.example", "x-test-account": "A" } });
    expect((await guardCase(bad, caseId))?.status).toBe(403);
  });
});

describe("claiming anonymous cases", () => {
  it("attaches only this session's unclaimed cases to the account", async () => {
    store.registerCase("c1", "s1");
    store.registerCase("c2", "s1", "B");
    store.registerCase("c3", "s2");
    expect(await store.claimSessionCases("s1", "A")).toBe(1);
    expect(await store.accountOf("c1")).toBe("A");
    expect(await store.accountOf("c2")).toBe("B");
    expect(await store.accountOf("c3")).toBeNull();
    expect(await store.casesForAccount("A")).toEqual(["c1"]);
  });
});
