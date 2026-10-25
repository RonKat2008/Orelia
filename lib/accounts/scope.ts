/**
 * Lane K: the one "Your documents" space.
 *
 * Documents live in the account library (account_documents) keyed by a scope id:
 *   - a signed-in account's id (the library), also used by every case that account owns;
 *   - `case:<caseId>` for an anonymous case (moved into the account when the case is claimed);
 *   - `draft:<sessionId>` for files added on /start before the case exists (adopted by the case after it is created).
 * Every store read and write is filtered by the scope id, so one scope can never see another's documents or chunks.
 */
import { rejectCrossOrigin } from '@/lib/auth/origin';
import { getOwnerStore, requireCaseOwner, type OwnerStore } from '@/lib/auth/ownership';
import { ensureSession, readSession } from '@/lib/auth/session';
import { currentAccount } from './current';
import { noStore } from './http';

export const CASE_SCOPE_PREFIX = 'case:';
export const DRAFT_SCOPE_PREFIX = 'draft:';

/** The scope a case's documents live in: its owning account's library, else the case's own space. */
export async function scopeForCase(caseId: string, owners: OwnerStore = getOwnerStore()): Promise<string> {
  return (await owners.accountOf?.(caseId)) ?? `${CASE_SCOPE_PREFIX}${caseId}`;
}

export type SpaceGuard =
  | { ok: true; scopeId: string; accountId: string | null; caseId: string | null; setCookie?: string }
  | { ok: false; response: Response };

const notFound = (): SpaceGuard => ({ ok: false, response: Response.json({ error: 'Not found' }, { status: 404, headers: noStore }) });

/**
 * Resolves which document space a request works in: `?case=<id>` (owner of that case), `?draft=1` (the intake step,
 * before a case exists) or neither (the signed-in account library, the original behaviour).
 */
export async function requireSpace(req: Request): Promise<SpaceGuard> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return { ok: false, response: csrf };
  const params = new URL(req.url).searchParams;
  const caseId = params.get('case');
  if (caseId) {
    const access = await requireCaseOwner(req, caseId);
    if (!access.ok) return { ok: false, response: access.response };
    return { ok: true, scopeId: await scopeForCase(caseId), accountId: await getOwnerStore().accountOf?.(caseId) ?? null, caseId };
  }
  const account = await currentAccount(req);
  if (params.get('draft')) {
    if (account) return { ok: true, scopeId: account.id, accountId: account.id, caseId: null };
    const existing = readSession(req);
    if (existing) return { ok: true, scopeId: `${DRAFT_SCOPE_PREFIX}${existing}`, accountId: null, caseId: null };
    if (req.method !== 'GET') return notFound();
    const fresh = ensureSession(req);
    return { ok: true, scopeId: `${DRAFT_SCOPE_PREFIX}${fresh.id}`, accountId: null, caseId: null, setCookie: fresh.setCookie };
  }
  if (!account) return notFound();
  return { ok: true, scopeId: account.id, accountId: account.id, caseId: null };
}

/** Adds the new-session cookie (draft scope) to a response. */
export function withSpaceCookie(res: Response, guard: Extract<SpaceGuard, { ok: true }>): Response {
  if (guard.setCookie) res.headers.append('Set-Cookie', guard.setCookie);
  return res;
}

/** The draft scope of this browser session, if it has one. */
export function draftScopeOf(req: Request): string | null {
  const session = readSession(req);
  return session ? `${DRAFT_SCOPE_PREFIX}${session}` : null;
}
