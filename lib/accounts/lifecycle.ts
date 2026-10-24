/**
 * Account lifecycle: claim anonymous cases, export everything, delete everything.
 * "Delete account" removes the account's cases (their rows cascade), every blob, every chunk/embedding, every
 * document, the profile, and finally the Neon Auth user. Nothing is logged except counts and error names.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { getOwnerStore, type OwnerStore } from '@/lib/auth/ownership';
import { getNeonAuth, accountsEnabled } from '@/lib/auth/neon';
import type { Account } from './contract';
import { getBlob, type BlobPort } from './blob';
import { getAccountStore, toLibraryDocument, type AccountStore } from './store';

export interface LifecycleDeps {
  store?: AccountStore;
  blob?: BlobPort;
  owners?: OwnerStore;
  deleteCase?: (caseId: string) => Promise<boolean>;
  deleteAuthUser?: (accountId: string) => Promise<void>;
}

export async function claimCases(sessionId: string | null, accountId: string, owners: OwnerStore = getOwnerStore()): Promise<number> {
  if (!sessionId || !owners.claimSessionCases) return 0;
  return owners.claimSessionCases(sessionId, accountId);
}

async function defaultDeleteCase(caseId: string): Promise<boolean> {
  const { getServices } = await import('@/app/api/cases/_lib/services');
  return getServices().cases.delete(caseId);
}

/** Neon Auth first (revokes sessions properly); a direct row delete is the fallback (sessions/accounts cascade). */
async function defaultDeleteAuthUser(accountId: string): Promise<void> {
  if (!accountsEnabled()) return;
  try {
    const auth = await getNeonAuth();
    const { error } = await auth.deleteUser({});
    if (!error) return;
  } catch (err) {
    console.error('[accounts] auth deleteUser failed; falling back', err instanceof Error ? err.name : 'error');
  }
  await getDb().execute(sql`DELETE FROM neon_auth."user" WHERE id::text = ${accountId}`);
}

export interface DeletionSummary { cases: number; documents: number; blobs: number }

export async function deleteAccount(accountId: string, deps: LifecycleDeps = {}): Promise<DeletionSummary> {
  const store = deps.store ?? getAccountStore();
  const owners = deps.owners ?? getOwnerStore();
  const caseIds = (await owners.casesForAccount?.(accountId)) ?? [];
  let cases = 0;
  for (const id of caseIds) if (await (deps.deleteCase ?? defaultDeleteCase)(id)) cases++;
  const docs = await store.listDocuments(accountId);
  const pathnames = docs.filter(d => d.accountId === accountId).map(d => d.blobPathname);
  await (deps.blob ?? getBlob()).remove(pathnames);
  const removed = await store.deleteAccountData(accountId);
  await (deps.deleteAuthUser ?? defaultDeleteAuthUser)(accountId);
  return { cases, documents: removed.length, blobs: pathnames.length };
}

/** Everything Wayfinder holds for the account, as JSON (document text included; files are downloadable separately). */
export async function exportAccount(account: Account, deps: Pick<LifecycleDeps, 'store' | 'owners'> = {}) {
  const store = deps.store ?? getAccountStore();
  const owners = deps.owners ?? getOwnerStore();
  const [profile, docs, caseIds] = await Promise.all([
    store.getProfile(account.id), store.listDocuments(account.id), owners.casesForAccount?.(account.id) ?? Promise.resolve([]),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { id: account.id, email: account.email, name: account.name },
    profile,
    documents: docs.map(d => ({ ...toLibraryDocument(d), extractedText: d.text })),
    caseIds,
    note: 'Original files can be downloaded from your document library. Case details are available on each case page.',
  };
}
