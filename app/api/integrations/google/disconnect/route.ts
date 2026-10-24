import { errorResponse, json, requireViewer } from '@/lib/appointments/http';
import { getConnectionStore, googleSync } from '@/lib/integrations/google/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/integrations/google/disconnect — revokes the grant at Google (best-effort) and deletes the tokens. */
export async function POST(req: Request) {
  const auth = await requireViewer(req);
  if (!auth.ok) return auth.response;
  try {
    await googleSync({ store: getConnectionStore() }).disconnect(auth.viewer.key);
    return json({ disconnected: true });
  } catch (error) { return errorResponse(error, 'google-disconnect'); }
}
