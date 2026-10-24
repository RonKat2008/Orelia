import { getViewer } from '@/lib/auth/viewer';
import { errorResponse, json } from '@/lib/appointments/http';
import { hasTokenKey } from '@/lib/crypto/token-box';
import { getConnectionStore } from '@/lib/integrations/google/connection';
import { googleConfig, SCOPE_FREEBUSY } from '@/lib/integrations/google/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/integrations/google/status — whether Google is configured here and whether this viewer connected it. */
export async function GET(req: Request) {
  const available = !!googleConfig() && hasTokenKey();
  const viewer = getViewer(req);
  if (!available || !viewer) return json({ available, connected: false, freeBusy: false });
  try {
    const c = await getConnectionStore().get(viewer.key);
    return json({ available, connected: !!c, freeBusy: !!c?.freeBusyOptIn && !!c?.scopes.includes(SCOPE_FREEBUSY) });
  } catch (error) { return errorResponse(error, 'google-status'); }
}
