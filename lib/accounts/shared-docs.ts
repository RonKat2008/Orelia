/**
 * Lane K -> lane F contract: the documents a patient marked "Share with resources" (account_documents.share_with_resources,
 * default false). Resource-facing agents (the agent factory) may read ONLY these, via this module, never the whole
 * document space. Reading is still not sending: anything leaving Orelia goes through minimize and checkOutbound.
 */
import type { MedicalHistoryHit } from './contract';
import { scopeForCase } from './scope';
import { searchMedicalHistory, type RetrieveDeps } from './retrieve';
import { getAccountStore } from './store';
import { getDocumentUseStore, type DocumentUseStore } from './uses';
import type { OwnerStore } from '@/lib/auth/ownership';

export interface SharedDocsDeps extends RetrieveDeps { owners?: OwnerStore; uses?: DocumentUseStore }

/** Titles and ids of the documents the patient shares with resource agents (no text). */
export async function listSharedDocuments(caseId: string, deps: SharedDocsDeps = {}): Promise<{ id: string; title: string; docType: string }[]> {
  const scope = await scopeForCase(caseId, deps.owners);
  return (await (deps.store ?? getAccountStore()).listDocuments(scope))
    .filter(d => d.accountId === scope && d.shareWithResources && d.status === 'embedded')
    .map(d => ({ id: d.id, title: d.title, docType: d.docType }));
}

/** Retrieval limited to shared documents. Records the use under `agent` (e.g. "resource:<contactId>"). */
export async function searchSharedDocuments(caseId: string, agent: string, query: string, k = 4, deps: SharedDocsDeps = {}): Promise<MedicalHistoryHit[]> {
  try {
    const shared = new Set((await listSharedDocuments(caseId, deps)).map(d => d.id));
    if (!shared.size) return [];
    const scope = await scopeForCase(caseId, deps.owners);
    const hits = (await searchMedicalHistory(scope, query, 20, deps)).filter(h => shared.has(h.documentId)).slice(0, k);
    const seen = new Map(hits.map(h => [h.documentId, h.title]));
    await (deps.uses ?? getDocumentUseStore()).record(caseId, [...seen].map(([documentId, title]) => ({ agent, documentId, title }))).catch(() => undefined);
    return hits;
  } catch {
    return [];
  }
}
