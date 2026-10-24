import { guardCase } from '@/lib/auth/ownership';
import { getViewer } from '@/lib/auth/viewer';
import { errorResponse, json, limited, MUTATION_LIMITS, publicAppointment, serviceDeps, viewerKeyOrIp } from '@/lib/appointments/http';
import { appointmentInputSchema } from '@/lib/appointments/schema';
import { createManual } from '@/lib/appointments/service';
import { getAppointmentStore } from '@/lib/appointments/store';
import { parseId } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/appointments — the case's appointments (proposed first-class, owner only). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return json({ error: 'Not found' }, 404);
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const appointments = await getAppointmentStore().listForCase(id);
    return json({ caseId: id, appointments: appointments.map(publicAppointment) });
  } catch (error) { return errorResponse(error, 'list'); }
}

/** POST /api/cases/[id]/appointments — the patient adds an appointment they booked themselves. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return json({ error: 'Not found' }, 404);
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const viewer = getViewer(req);
  const slow = await limited(MUTATION_LIMITS(viewerKeyOrIp(req, viewer)));
  if (slow) return slow;
  try {
    const input = appointmentInputSchema.parse(await req.json());
    const owner = await getAppointmentStore().caseOwner(id);
    const appointment = await createManual(serviceDeps(req), id, viewer?.key ?? owner ?? null, input);
    return json({ appointment: publicAppointment(appointment) }, 201);
  } catch (error) { return errorResponse(error, 'create'); }
}
