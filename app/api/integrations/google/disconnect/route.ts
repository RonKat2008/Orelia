import { rejectCrossOrigin } from '@/lib/auth/origin';
import { getViewer } from '@/lib/auth/viewer';
import { errorResponse, json } from '@/lib/appointments/http';
import { getConnectionStore, googleSync } from '@/lib/integrations/google/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/integrations/google/disconnect — revokes the grant at Google (best-effort) and deletes the tokens. */
export async function POST(req: Request) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const viewer = getViewer(req);
  if (!viewer) return json({ disconnected: true });
  try {
    await googleSync({ store: getConnectionStore() }).disconnect(viewer.key);
    return json({ disconnected: true });
  } catch (error) { return errorResponse(error, 'google-disconnect'); }
}
