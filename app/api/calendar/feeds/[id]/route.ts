import { rejectCrossOrigin } from '@/lib/auth/origin';
import { getViewer } from '@/lib/auth/viewer';
import { errorResponse, json, notFound } from '@/lib/appointments/http';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/calendar/feeds/[id] — revoke a feed; its URL stops working immediately. Owner only. */
export async function DELETE(req: Request, { params }: Ctx) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { id } = await params;
  const viewer = await getViewer(req);
  if (!viewer || !UUID.test(id)) return notFound();
  try {
    const ok = await getAppointmentStore().revokeFeed(id, viewer.key, new Date());
    return ok ? json({ revoked: true }) : notFound();
  } catch (error) { return errorResponse(error, 'feed-revoke'); }
}
