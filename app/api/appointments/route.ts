import { errorResponse, json, publicAppointment, requireViewer } from '@/lib/appointments/http';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/appointments — every appointment on the viewer's own cases (404 without a session that owns a case). */
export async function GET(req: Request) {
  const auth = await requireViewer(req);
  if (!auth.ok) return auth.response;
  const { viewer } = auth;
  try {
    const appointments = await getAppointmentStore().listForOwner(viewer.key);
    return json({ appointments: appointments.map(publicAppointment) });
  } catch (error) { return errorResponse(error, 'list-owner'); }
}
