import { errorResponse, json, requireViewer } from '@/lib/appointments/http';
import { hasTokenKey } from '@/lib/crypto/token-box';
import { getConnectionStore } from '@/lib/integrations/google/connection';
import { googleConfig, SCOPE_FREEBUSY } from '@/lib/integrations/google/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/integrations/google/status — whether Google is configured here and whether this viewer connected it. */
export async function GET(req: Request) {
  const auth = await requireViewer(req);
  if (!auth.ok) return auth.response;
  const available = !!googleConfig() && hasTokenKey();
  try {
    const c = await getConnectionStore().get(auth.viewer.key);
    return json({ available, connected: available && !!c, freeBusy: available && !!c?.freeBusyOptIn && !!c?.scopes.includes(SCOPE_FREEBUSY) });
  } catch (error) { return errorResponse(error, 'google-status'); }
}
