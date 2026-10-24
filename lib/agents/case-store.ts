import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cases } from "@/db/schema";
import type { Case, CaseInput } from "@/lib/contracts";

export interface CaseStore {
  create(input: CaseInput, status?: string): Promise<Case>;
  get(id: string): Promise<Case | null>;
  /** Replace the editable fields and set the status. */
  update(id: string, input: CaseInput, status: string): Promise<Case | null>;
  setStatus(id: string, status: string): Promise<void>;
  /** Atomically claim a case, including across server instances. */
  compareAndSetStatus(id: string, expected: readonly string[], status: string): Promise<boolean>;
}

type Row = typeof cases.$inferSelect;

function rowToCase(row: Row): Case {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    diseaseName: row.diseaseName,
    diseaseCodes: row.diseaseCodes ?? undefined,
    subtype: row.subtype ?? undefined,
    stageSummary: row.stageSummary ?? undefined,
    homeCity: row.homeCity ?? undefined,
    homeState: row.homeState ?? undefined,
    insurer: row.insurer ?? undefined,
    planId: row.planId ?? undefined,
    travelLimitMiles: row.travelLimitMiles ?? undefined,
    goals: row.goals ?? [],
  };
}

function inputToValues(input: CaseInput) {
  return {
    diseaseName: input.diseaseName,
    diseaseCodes: input.diseaseCodes ?? null,
    subtype: input.subtype ?? null,
    stageSummary: input.stageSummary ?? null,
    homeCity: input.homeCity ?? null,
    homeState: input.homeState ?? null,
    insurer: input.insurer ?? null,
    planId: input.planId ?? null,
    travelLimitMiles: input.travelLimitMiles ?? null,
    goals: input.goals,
  };
}

export class DbCaseStore implements CaseStore {
  constructor(private readonly db: ReturnType<typeof getDb> = getDb()) {}

  async create(input: CaseInput, status = "draft"): Promise<Case> {
    const [row] = await this.db.insert(cases).values({ ...inputToValues(input), status }).returning();
    if (!row) throw new Error("Failed to insert case");
    return rowToCase(row);
  }

  async get(id: string): Promise<Case | null> {
    const [row] = await this.db.select().from(cases).where(eq(cases.id, id));
    return row ? rowToCase(row) : null;
  }

  async update(id: string, input: CaseInput, status: string): Promise<Case | null> {
    const [row] = await this.db.update(cases).set({ ...inputToValues(input), status }).where(eq(cases.id, id)).returning();
    return row ? rowToCase(row) : null;
  }

  async compareAndSetStatus(id: string, expected: readonly string[], status: string): Promise<boolean> {
    const rows = await this.db.update(cases).set({ status })
      .where(and(eq(cases.id, id), inArray(cases.status, [...expected])))
      .returning({ id: cases.id });
    return rows.length === 1;
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.db.update(cases).set({ status }).where(eq(cases.id, id));
  }
}

export class MemoryCaseStore implements CaseStore {
  private readonly rows = new Map<string, Case>();

  async create(input: CaseInput, status = "draft"): Promise<Case> {
    const c: Case = { ...input, id: randomUUID(), status, createdAt: new Date().toISOString() };
    this.rows.set(c.id, c);
    return c;
  }

  async get(id: string): Promise<Case | null> {
    return this.rows.get(id) ?? null;
  }

  async update(id: string, input: CaseInput, status: string): Promise<Case | null> {
    const prev = this.rows.get(id);
    if (!prev) return null;
    const next: Case = { ...input, id, status, createdAt: prev.createdAt };
    this.rows.set(id, next);
    return next;
  }

  async compareAndSetStatus(id: string, expected: readonly string[], status: string): Promise<boolean> {
    const prev = this.rows.get(id);
    if (!prev || !expected.includes(prev.status)) return false;
    this.rows.set(id, { ...prev, status });
    return true;
  }

  async setStatus(id: string, status: string): Promise<void> {
    const prev = this.rows.get(id);
    if (prev) this.rows.set(id, { ...prev, status });
  }
}
