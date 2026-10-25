/**
 * Lane K: which of the patient's documents each agent read for a case. Titles only, never text. The judge view shows
 * "Used 2 of your documents" from this. Best effort: recording a use must never fail an agent.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { documentUses } from '@/db/schema';

export interface DocumentUse { agent: string; documentId: string; title: string }
export interface DocumentUseStore {
  record(caseId: string, uses: readonly DocumentUse[]): Promise<void>;
  list(caseId: string): Promise<DocumentUse[]>;
}

export class MemoryDocumentUseStore implements DocumentUseStore {
  private rows = new Map<string, DocumentUse[]>();
  async record(caseId: string, uses: readonly DocumentUse[]) {
    const list = this.rows.get(caseId) ?? [];
    for (const u of uses) if (!list.some(x => x.agent === u.agent && x.documentId === u.documentId)) list.push({ ...u });
    this.rows.set(caseId, list);
  }
  async list(caseId: string) { return structuredClone(this.rows.get(caseId) ?? []); }
}

export class PostgresDocumentUseStore implements DocumentUseStore {
  async record(caseId: string, uses: readonly DocumentUse[]) {
    if (!uses.length) return;
    await getDb().insert(documentUses).values(uses.map(u => ({ caseId, agent: u.agent, documentId: u.documentId, title: u.title.slice(0, 200) })))
      .onConflictDoUpdate({ target: [documentUses.caseId, documentUses.agent, documentUses.documentId], set: { title: documentUses.title } });
  }
  async list(caseId: string) {
    return (await getDb().select({ agent: documentUses.agent, documentId: documentUses.documentId, title: documentUses.title })
      .from(documentUses).where(and(eq(documentUses.caseId, caseId))).orderBy(asc(documentUses.createdAt)));
  }
}

const g = globalThis as { __wayfinderDocUses?: DocumentUseStore };
export function getDocumentUseStore(): DocumentUseStore {
  return g.__wayfinderDocUses ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresDocumentUseStore() : new MemoryDocumentUseStore();
}
export function setDocumentUseStoreForTests(store: DocumentUseStore | undefined): void {
  if (store) g.__wayfinderDocUses = store; else delete g.__wayfinderDocUses;
}
