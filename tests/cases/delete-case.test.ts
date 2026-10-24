import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as caseDelete } from "../../app/api/cases/[id]/route";
import { getServices } from "../../app/api/cases/_lib/services";
import { deleteCase } from "../../components/journey/delete-case";
import * as schema from "../../db/schema";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { resetMemoryRateLimitStore } from "../../lib/rate-limit";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};

let store: MemoryOwnerStore;
beforeEach(() => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  resetMemoryRateLimitStore();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
});

const mkCase = async (owner: string) => {
  const created = await getServices().cases.create({ diseaseName: "Synthetic vEDS", goals: [] } as never, "confirmed");
  store.registerCase(created.id, owner);
  return created.id;
};
const del = (id: string, c?: string, origin: string | null = ORIGIN) =>
  caseDelete(new Request(`${ORIGIN}/api/cases/${id}`, { method: "DELETE", headers: { ...(c ? { cookie: c } : {}), ...(origin ? { origin } : {}) } }), ctx(id));

describe("DELETE /api/cases/[id]", () => {
  it("lets the owner delete; afterwards the case is a 404", async () => {
    const id = await mkCase("owner");
    expect((await del(id, cookie("owner"))).status).toBe(200);
    expect(await getServices().cases.get(id)).toBeNull();
  });

  it("refuses cross-origin (403), no session and non-owners (404) without deleting", async () => {
    const id = await mkCase("owner");
    expect((await del(id, cookie("owner"), "http://evil.test")).status).toBe(403);
    expect((await del(id, cookie("owner"), null)).status).toBe(403);
    expect((await del(id)).status).toBe(404);
    expect((await del(id, cookie("other"))).status).toBe(404);
    expect(await getServices().cases.get(id)).not.toBeNull();
  });

  it("rejects malformed ids and rate limits a runaway session", async () => {
    expect((await del("not-a-uuid", cookie("owner"))).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await del(await mkCase("owner"), cookie("owner"))).status;
    expect(last).toBe(429);
  });
});

describe("deleteCase client helper", () => {
  const res = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
  it("maps responses to a result", async () => {
    expect(await deleteCase("abc", res(200))).toEqual({ ok: true });
    expect(await deleteCase("abc", res(404))).toEqual({ ok: true });
    expect(await deleteCase("abc", res(429))).toMatchObject({ ok: false });
    expect(await deleteCase("abc", res(500))).toMatchObject({ ok: false });
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await deleteCase("abc", boom)).toMatchObject({ ok: false });
  });
  it("calls DELETE on the case url", async () => {
    const calls: [unknown, RequestInit | undefined][] = [];
    await deleteCase("a/b", (async (u: unknown, i?: RequestInit) => { calls.push([u, i]); return new Response("{}"); }) as unknown as typeof fetch);
    expect(calls[0]).toEqual(["/api/cases/a%2Fb", { method: "DELETE" }]);
  });
});

describe("cascade coverage", () => {
  it("every foreign key to cases, contacts or tasks cascades on delete", () => {
    const parents = new Set<unknown>([schema.cases, schema.contacts, schema.tasks]);
    const offenders: string[] = [];
    for (const t of Object.values(schema)) {
      if (!t || typeof t !== "object" || !("getSQL" in (t as object))) continue;
      let cfg;
      try { cfg = getTableConfig(t as never); } catch { continue; }
      for (const fk of cfg.foreignKeys) {
        const ref = fk.reference();
        if (parents.has(ref.foreignTable) && fk.onDelete !== "cascade") offenders.push(`${cfg.name}.${ref.columns.map((c) => c.name).join(",")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ships migration 0039 and registers it in the journal", () => {
    const sql = readFileSync(path.join(process.cwd(), "drizzle/0039_case_delete_cascade.sql"), "utf8");
    expect(sql).toMatch(/ON DELETE CASCADE/);
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain("0039_case_delete_cascade");
  });
});
