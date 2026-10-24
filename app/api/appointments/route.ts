import { getViewer } from '@/lib/auth/viewer';
import { errorResponse, json, publicAppointment } from '@/lib/appointments/http';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/appointments — every appointment on the viewer's own cases (empty without a session). */
export async function GET(req: Request) {
  const viewer = getViewer(req);
  if (!viewer) return json({ appointments: [] });
  try {
    const appointments = await getAppointmentStore().listForOwner(viewer.key);
    return json({ appointments: appointments.map(publicAppointment) });
  } catch (error) { return errorResponse(error, 'list-owner'); }
}
