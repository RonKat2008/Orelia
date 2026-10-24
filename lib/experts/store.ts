import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { expertTraces } from '@/db/schema';
import { expertTraceSchema, type ExpertTrace } from './contract';

export interface ExpertTraceStore {
  latest(caseId: string): Promise<ExpertTrace | null>;
  save(trace: ExpertTrace): Promise<ExpertTrace | null>;
}

const parse = (raw: unknown): ExpertTrace | null => {
  const r = expertTraceSchema.safeParse(raw);
  return r.success ? r.data : null;
};

export class MemoryExpertTraceStore implements ExpertTraceStore {
  private readonly traces = new Map<string, ExpertTrace>();
  async latest(caseId: string): Promise<ExpertTrace | null> {
    return parse(structuredClone(this.traces.get(caseId)));
  }
  async save(trace: ExpertTrace): Promise<ExpertTrace | null> {
    const valid = parse(trace);
    if (!valid) return null;
    this.traces.set(valid.caseId, structuredClone(valid));
    return valid;
  }
}

/** Evidence rows stay inside the trace jsonb: tracer ids are not uuids, so they do not fit the `evidence` table. */
export class PostgresExpertTraceStore implements ExpertTraceStore {
  private get db() { return getDb(); }
  async latest(caseId: string): Promise<ExpertTrace | null> {
    const [row] = await this.db.select().from(expertTraces).where(eq(expertTraces.caseId, caseId)).orderBy(desc(expertTraces.tracedAt)).limit(1);
    return row ? parse(row.trace) : null;
  }
  async save(trace: ExpertTrace): Promise<ExpertTrace | null> {
    const valid = parse(trace);
    if (!valid) return null;
    await this.db.insert(expertTraces).values({ caseId: valid.caseId, tracedAt: new Date(valid.tracedAt), trace: valid as unknown as Record<string, unknown> });
    return valid;
  }
}

const g = globalThis as unknown as { __wayfinderExpertTraceStore?: ExpertTraceStore };

export function getExpertTraceStore(): ExpertTraceStore {
  g.__wayfinderExpertTraceStore ??= process.env.DATABASE_URL ? new PostgresExpertTraceStore() : new MemoryExpertTraceStore();
  return g.__wayfinderExpertTraceStore;
}

export function setExpertTraceStoreForTests(store: ExpertTraceStore | undefined): void {
  if (store) g.__wayfinderExpertTraceStore = store;
  else delete g.__wayfinderExpertTraceStore;
}
