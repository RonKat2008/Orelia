/**
 * Lane K: what an agent gets from the patient's document space. One entry point so every agent reads the same,
 * case-scoped, sanitized snippets and the judge view can show which documents each agent used.
 *
 * Scope is fixed by the case id (never by model arguments): searchCaseLibrary resolves the owning account (or the
 * case's own space) and the store query is filtered by that scope. Snippets are untrusted DATA with a citation.
 */
import type { MedicalHistoryHit } from './contract';
import { searchCaseLibrary } from './case-link';
import { historyContextBlock, type RetrieveDeps } from './retrieve';
import { getDocumentUseStore, type DocumentUseStore } from './uses';
import type { OwnerStore } from '@/lib/auth/ownership';

export interface AgentDocsDeps extends RetrieveDeps { owners?: OwnerStore; uses?: DocumentUseStore; k?: number; maxChars?: number }
export interface AgentDocs { block: string; hits: MedicalHistoryHit[]; used: { id: string; title: string }[] }
const EMPTY: AgentDocs = { block: '', hits: [], used: [] };

/** Distinct documents behind a set of hits, in hit order. */
export function usedDocuments(hits: readonly MedicalHistoryHit[]): { id: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const h of hits) if (!seen.has(h.documentId)) seen.set(h.documentId, h.title);
  return [...seen].map(([id, title]) => ({ id, title }));
}

/** "Used 2 of your documents" copy, singular-aware. */
export function usedLabel(count: number): string {
  return count === 1 ? 'Used 1 of your documents' : `Used ${count} of your documents`;
}

/**
 * Search the case's document space for `query` and record which documents `agent` read. Never throws: an agent
 * must work the same without documents (empty result) when the search or the recording fails.
 */
export async function documentsForAgent(caseId: string, agent: string, query: string, deps: AgentDocsDeps = {}): Promise<AgentDocs> {
  try {
    const { results } = await searchCaseLibrary(caseId, query, deps.k ?? 4, deps);
    if (!results.length) return EMPTY;
    const used = usedDocuments(results);
    await (deps.uses ?? getDocumentUseStore()).record(caseId, used.map(u => ({ agent, documentId: u.id, title: u.title }))).catch(() => undefined);
    return { block: historyContextBlock(results, deps.maxChars ?? 500), hits: results, used };
  } catch {
    return EMPTY;
  }
}
