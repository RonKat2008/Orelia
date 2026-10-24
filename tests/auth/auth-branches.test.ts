import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as string[] }));
vi.mock("@/db/client", () => {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "from", "leftJoin", "where", "set"]) {
    chain[name] = () => { db.calls.push(name); return chain; };
  }
  chain.limit = async () => db.rows;
  // update().set().where() is awaited directly, so where() must be thenable for that path.
  chain.update = () => { db.calls.push("update"); return { set: () => ({ where: async () => { db.calls.push("updated"); } }) }; };
  return { getDb: () => chain };
});

import { isSameOrigin, rejectCrossOrigin } from "../../lib/auth/origin";
import { MemoryOwnerStore, PostgresOwnerStore, canAccess, getOwnerStore } from "../../lib/auth/ownership";
import { readSession, signSession, SESSION_COOKIE } from "../../lib/auth/session";

const SECRET = { WAYFINDER_SESSION_SECRET: "test-secret" };
const post = (headers: Record<string, string>, url = "https://app.example.test/api/x") =>
  new Request(url, { method: "POST", headers });
/** A request whose url is unparseable, which the Request constructor itself cannot produce. */
const brokenUrlRequest = (headers: Record<string, string>) =>
  ({ method: "POST", url: "not a url", headers: new Headers(headers) }) as unknown as Request;

describe("origin: refuses state-changing requests it cannot attribute", () => {
  it("rejects a non-http(s) Origin even when the scheme-less comparison would look similar", () => {
    const req = post({ origin: "ftp://app.example.test" });
    expect(isSameOrigin(req, {})).toBe(false);
  });
  it("rejects every origin when WAYFINDER_APP_ORIGIN is configured but invalid", () => {
    const req = post({ origin: "https://app.example.test" });
    expect(isSameOrigin(req, { WAYFINDER_APP_ORIGIN: "javascript:alert(1)" })).toBe(false);
  });
  it("accepts only the configured origin when WAYFINDER_APP_ORIGIN is valid", () => {
    expect(isSameOrigin(post({ origin: "https://app.example.test" }), { WAYFINDER_APP_ORIGIN: "https://app.example.test/path" })).toBe(true);
    expect(isSameOrigin(post({ origin: "https://evil.example.test" }), { WAYFINDER_APP_ORIGIN: "https://app.example.test" })).toBe(false);
  });
  it("accepts a forwarded host using the forwarded protocol", () => {
    const req = post({ origin: "https://public.example.test", "x-forwarded-host": "public.example.test, internal", "x-forwarded-proto": "https, http" });
    expect(isSameOrigin(req, {})).toBe(true);
  });
  it("falls back to the request protocol when x-forwarded-proto is absent", () => {
    const req = post({ origin: "https://public.example.test", "x-forwarded-host": "public.example.test" });
    expect(isSameOrigin(req, {})).toBe(true);
  });
  it("defaults the forwarded protocol to https when the request url is unparseable", () => {
    const req = brokenUrlRequest({ origin: "https://public.example.test", "x-forwarded-host": "public.example.test" });
    expect(isSameOrigin(req, {})).toBe(true);
  });
  it("rejects when the request url is unparseable and no forwarded host exists", () => {
    expect(isSameOrigin(brokenUrlRequest({ origin: "https://app.example.test" }), {})).toBe(false);
  });
  it("ignores a forwarded host that does not form a valid origin", () => {
    const req = post({ origin: "https://public.example.test", "x-forwarded-host": "bad host" });
    expect(isSameOrigin(req, {})).toBe(false);
  });
  it("answers a cross-origin POST with a 403 and lets safe methods through", async () => {
    const blocked = rejectCrossOrigin(post({ origin: "https://evil.example.test" }), {});
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toEqual({ error: "Forbidden" });
    expect(rejectCrossOrigin(new Request("https://app.example.test/x"), {})).toBeNull();
  });
});

describe("session: cookie parsing fails closed", () => {
  it("skips malformed cookie parts and finds the session cookie after them", () => {
    const value = signSession("session-1", SECRET);
    const req = new Request("https://app.example.test/", { headers: { cookie: `garbage; other=1; ${SESSION_COOKIE}=${value}` } });
    expect(readSession(req, SECRET)).toBe("session-1");
  });
  it("returns null when the only cookie parts are malformed or unrelated", () => {
    const req = new Request("https://app.example.test/", { headers: { cookie: "garbage; other=1" } });
    expect(readSession(req, SECRET)).toBeNull();
  });
  it("returns null for a tampered session cookie", () => {
    const value = signSession("session-1", SECRET).replace("session-1", "session-2");
    const req = new Request("https://app.example.test/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });
    expect(readSession(req, SECRET)).toBeNull();
  });
});

describe("PostgresOwnerStore: missing rows deny access", () => {
  const store = new PostgresOwnerStore();
  beforeEach(() => { db.rows = []; db.calls = []; });

  it("reports no such case as undefined and an unowned case as null", async () => {
    expect(await store.ownerOf("c1")).toBeUndefined();
    db.rows = [{ owner: null }];
    expect(await store.ownerOf("c1")).toBeNull();
    db.rows = [{ owner: "s1" }];
    expect(await store.ownerOf("c1")).toBe("s1");
  });
  it("writes the owner through the update chain", async () => {
    await store.setOwner("c1", "s1");
    expect(db.calls).toContain("updated");
  });
  it("resolves a contact to its case, or undefined when it is missing", async () => {
    expect(await store.caseIdForContact("k1")).toBeUndefined();
    db.rows = [{ caseId: "c1" }];
    expect(await store.caseIdForContact("k1")).toBe("c1");
  });
  it("resolves a task via its direct case, then via its contact, else undefined", async () => {
    expect(await store.caseIdForTask("t1")).toBeUndefined();
    db.rows = [{ direct: "c-direct", viaContact: "c-contact" }];
    expect(await store.caseIdForTask("t1")).toBe("c-direct");
    db.rows = [{ direct: null, viaContact: "c-contact" }];
    expect(await store.caseIdForTask("t1")).toBe("c-contact");
    db.rows = [{ direct: null, viaContact: null }];
    expect(await store.caseIdForTask("t1")).toBeUndefined();
  });
  it("denies access when the case lookup finds nothing", async () => {
    expect(canAccess(await store.ownerOf("c1"), "s1", {})).toBe(false);
  });
});

describe("getOwnerStore backend selection", () => {
  const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
  let savedUrl: string | undefined;
  beforeEach(() => { savedUrl = process.env.DATABASE_URL; delete holder.__wayfinderOwnerStore; });
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
    delete holder.__wayfinderOwnerStore;
  });

  it("uses the in-memory store without DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(getOwnerStore()).toBeInstanceOf(MemoryOwnerStore);
  });
  it("uses Postgres when DATABASE_URL is set and caches the instance", () => {
    process.env.DATABASE_URL = "postgres://user:pw@localhost:5432/synthetic";
    const first = getOwnerStore();
    expect(first).toBeInstanceOf(PostgresOwnerStore);
    expect(getOwnerStore()).toBe(first);
  });
});
