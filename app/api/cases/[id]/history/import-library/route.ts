import { requireCaseOwner } from '@/lib/auth/ownership';
import { rejectCrossOrigin } from '@/lib/auth/origin';
import { caseAccountId, importLibraryIntoCase } from '@/lib/accounts/case-link';
import { getOwnerStore } from '@/lib/auth/ownership';
import { gatewayConfig } from '@/lib/ai/gateway';
import { fail, json } from '@/lib/accounts/http';
import { parseId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/cases/[id]/history/import-library -> { imported, skipped, timeline }
 * Copies the signed-in account's embedded library documents into this case's medical history. The case must be the
 * caller's (guard) and belong to the caller's account; an anonymous case the caller owns is linked to the account first.
 */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return fail(400, 'invalid_case');
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const access = await requireCaseOwner(req, id);
  if (!access.ok) return access.response;
  if (!access.accountId) return fail(401, 'sign_in_required', 'Sign in to use documents from your library.');
  const owner = await caseAccountId(id);
  if (owner && owner !== access.accountId) return fail(403, 'forbidden');
  if (!owner) await getOwnerStore().setAccount?.(id, access.accountId);
  try {
    return json(await importLibraryIntoCase(id, access.accountId, { llm: Boolean(gatewayConfig()) }));
  } catch (err) {
    return fail(500, 'import_failed', 'We could not add your documents. Please try again.', err);
  }
}
