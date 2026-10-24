import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contactPlans } from '@/db/schema';
import { contactPlanSchema, type ContactPlan, type PlanStore } from './contract';

function parsePlan(raw: unknown): ContactPlan | null {
  const parsed = contactPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Process-local store (dev/tests). Stores validated deep copies so callers cannot mutate saved state. */
export class MemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, ContactPlan>();

  async latest(caseId: string): Promise<ContactPlan | null> {
    return parsePlan(structuredClone(this.plans.get(caseId)));
  }

  async save(plan: ContactPlan, expectedVersion?: number): Promise<ContactPlan | null> {
    const valid = parsePlan(plan);
    if (!valid) return null;
    const current = this.plans.get(valid.caseId);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) return null;
    this.plans.set(valid.caseId, structuredClone(valid));
    return valid;
  }
}

export class PostgresPlanStore implements PlanStore {
  private get db() { return getDb(); }

  async latest(caseId: string): Promise<ContactPlan | null> {
    const [row] = await this.db.select().from(contactPlans).where(eq(contactPlans.caseId, caseId)).limit(1);
    return row ? parsePlan(row.plan) : null;
  }

  async save(plan: ContactPlan, expectedVersion?: number): Promise<ContactPlan | null> {
    const valid = parsePlan(plan);
    if (!valid) return null;
    const values = {
      version: valid.version,
      status: valid.status,
      source: valid.source,
      plan: valid as unknown as Record<string, unknown>,
      updatedAt: new Date(valid.updatedAt),
      approvedAt: valid.approvedAt ? new Date(valid.approvedAt) : null,
    };
    if (expectedVersion !== undefined) {
      const rows = await this.db.update(contactPlans).set(values)
        .where(and(eq(contactPlans.caseId, valid.caseId), eq(contactPlans.version, expectedVersion)))
        .returning({ caseId: contactPlans.caseId });
      return rows.length === 1 ? valid : null;
    }
    await this.db.insert(contactPlans)
      .values({ caseId: valid.caseId, createdAt: new Date(valid.createdAt), ...values })
      .onConflictDoUpdate({ target: contactPlans.caseId, set: values });
    return valid;
  }
}

const g = globalThis as unknown as { __wayfinderPlanStore?: PlanStore };

export function getPlanStore(): PlanStore {
  g.__wayfinderPlanStore ??= process.env.DATABASE_URL ? new PostgresPlanStore() : new MemoryPlanStore();
  return g.__wayfinderPlanStore;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setPlanStoreForTests(store: PlanStore | undefined): void {
  if (store) g.__wayfinderPlanStore = store;
  else delete g.__wayfinderPlanStore;
}
