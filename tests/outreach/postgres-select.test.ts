import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const captured: unknown[] = [];
vi.mock("../../db/client", () => ({
  getDb: () => ({
    update: () => ({ set: () => ({ where: () => ({ returning: () => "lock" }) }) }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
    execute: (q: unknown) => { captured.push(q); return q; },
    batch: async () => [[], { rows: [{ id: "new" }] }],
  }),
}));

import { dedupeProposedContacts, PostgresOutreachStore } from "../../lib/outreach/postgres-store";
import type { Contact } from "../../lib/outreach/types";

const target = crypto.randomUUID();
const mk = (address: string): Contact => ({ id: crypto.randomUUID(), caseId: crypto.randomUUID(), targetId: target, targetKind: "institution", channel: "email", address, state: "drafted" }) as Contact;

describe("dedupeProposedContacts", () => {
  it("keeps a second contact at the same target with a different address", () => {
    const proposed = [mk("billing@example.org")];
    expect(dedupeProposedContacts([mk("intake@example.org")], proposed)).toEqual(proposed);
  });
  it("skips a proposal whose address already exists (case/space-insensitive)", () => {
    expect(dedupeProposedContacts([mk("intake@example.org")], [mk("  Intake@Example.org ")])).toEqual([]);
  });
  it("dedupes within the proposal set", () => {
    expect(dedupeProposedContacts([], [mk("a@x.org"), mk("A@x.org"), mk("b@x.org")])).toHaveLength(2);
  });
});

describe("PostgresOutreachStore.select SQL", () => {
  beforeEach(() => { captured.length = 0; });
  it("dedupes on case + normalized address, not on target, and keeps the cap check", async () => {
    await new PostgresOutreachStore().select(crypto.randomUUID(), [mk("dept2@example.org")], 5).catch(() => {});
    expect(captured).toHaveLength(1);
    const { sql } = new PgDialect().sqlToQuery(captured[0] as never);
    expect(sql).toMatch(/lower\(btrim\(c\.address\)\) = lower\(btrim\(p\.address\)\)/);
    expect(sql).not.toMatch(/c\.target_id = p/);
    expect(sql).toMatch(/<= \$\d+/);
    expect(sql).toMatch(/count\(\*\)/);
  });
});
