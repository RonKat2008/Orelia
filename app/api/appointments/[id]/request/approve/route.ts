import { z } from 'zod';
import { authorizeAppointment, errorResponse, json, limited, publicAppointment, REQUEST_LIMITS, serviceDeps, viewerKeyOrIp } from '@/lib/appointments/http';
import { approveAndSendRequest } from '@/lib/appointments/request';
import { requestDeps } from '@/lib/appointments/request-wiring';
import { markCancelled, markRescheduling } from '@/lib/appointments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ kind: z.enum(['reschedule', 'cancel']) }).strict();

/** POST /api/appointments/[id]/request/approve — the patient approves the drafted request; the gate decides if it sends. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeAppointment(req, (await params).id);
  if (!auth.ok) return auth.response;
  const slow = await limited(REQUEST_LIMITS(viewerKeyOrIp(req, auth.viewer)));
  if (slow) return slow;
  try {
    const { kind } = bodySchema.parse(await req.json());
    const sent = await approveAndSendRequest(auth.appt, requestDeps());
    const deps = serviceDeps(req);
    const owner = auth.viewer?.key ?? auth.appt.ownerKey;
    const appointment = kind === 'cancel'
      ? await markCancelled(deps, auth.appt, owner)
      : auth.appt.status === 'confirmed' ? await markRescheduling(deps, auth.appt, owner) : auth.appt;
    return json({ sentAt: sent.sentAt, appointment: publicAppointment(appointment) });
  } catch (error) { return errorResponse(error, 'request-approve'); }
}
