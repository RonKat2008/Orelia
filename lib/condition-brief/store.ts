import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conditionBriefs } from "@/db/schema";
import { conditionBriefSchema, type ConditionBrief, type ConditionBriefStore } from "./contract";

function parseBrief(raw: unknown): ConditionBrief | null {
  const parsed = conditionBriefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function requireValid(brief: ConditionBrief): ConditionBrief {
  const valid = parseBrief(brief);
  if (!valid) throw new Error("Refusing to save an invalid condition brief");
  return valid;
}

/** Process-local store (dev/tests). Stores validated deep copies so callers cannot mutate saved state. */
export class MemoryConditionBriefStore implements ConditionBriefStore {
  private readonly briefs = new Map<string, ConditionBrief>();

  async latest(caseId: string): Promise<ConditionBrief | null> {
    const found = this.briefs.get(caseId);
    return found ? parseBrief(structuredClone(found)) : null;
  }

  async save(brief: ConditionBrief): Promise<ConditionBrief> {
    const valid = requireValid(brief);
    this.briefs.set(valid.caseId, structuredClone(valid));
    return structuredClone(valid);
  }
}

export class PostgresConditionBriefStore implements ConditionBriefStore {
  private get db() { return getDb(); }

  async latest(caseId: string): Promise<ConditionBrief | null> {
    const [row] = await this.db.select().from(conditionBriefs).where(eq(conditionBriefs.caseId, caseId)).limit(1);
    return row ? parseBrief(row.brief) : null;
  }

  async save(brief: ConditionBrief): Promise<ConditionBrief> {
    const valid = requireValid(brief);
    const values = {
      version: valid.version,
      brief: valid as unknown as Record<string, unknown>,
      generatedAt: new Date(valid.generatedAt),
      updatedAt: new Date(),
    };
    await this.db.insert(conditionBriefs)
      .values({ caseId: valid.caseId, ...values })
      .onConflictDoUpdate({ target: conditionBriefs.caseId, set: values });
    return valid;
  }
}

const g = globalThis as unknown as { __wayfinderConditionBriefStore?: ConditionBriefStore };

export function getConditionBriefStore(): ConditionBriefStore {
  g.__wayfinderConditionBriefStore ??= process.env.DATABASE_URL ? new PostgresConditionBriefStore() : new MemoryConditionBriefStore();
  return g.__wayfinderConditionBriefStore;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setConditionBriefStoreForTests(store: ConditionBriefStore | undefined): void {
  if (store) g.__wayfinderConditionBriefStore = store;
  else delete g.__wayfinderConditionBriefStore;
}
