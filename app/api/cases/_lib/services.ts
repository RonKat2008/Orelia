import { DbCaseStore, MemoryCaseStore, type CaseStore } from "@/lib/agents/case-store";
import { DbPersist, MemoryPersist, type Persist } from "@/lib/agents/persist";
import { DbRunStore, MemoryRunStore, type RunStore } from "@/lib/agents/run-store";

export interface Services {
  cases: CaseStore;
  runs: RunStore;
  persist: Persist;
}

const g = globalThis as unknown as { __wayfinderServices?: Services };

/**
 * Postgres when DATABASE_URL is set; otherwise process-local memory (local dev / offline only: state is lost on
 * restart and not shared across serverless instances).
 */
export function getServices(): Services {
  g.__wayfinderServices ??= process.env.DATABASE_URL
    ? { cases: new DbCaseStore(), runs: new DbRunStore(), persist: new DbPersist() }
    : { cases: new MemoryCaseStore(), runs: new MemoryRunStore(), persist: new MemoryPersist() };
  return g.__wayfinderServices;
}
