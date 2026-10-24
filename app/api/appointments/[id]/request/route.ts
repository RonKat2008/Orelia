import { z } from 'zod';
import { authorizeAppointment, errorResponse, json, limited, publicAppointment, REQUEST_LIMITS, serviceDeps, viewerKeyOrIp } from '@/lib/appointments/http';
import { createRequestDraft } from '@/lib/appointments/request';
import { requestDeps } from '@/lib/appointments/request-wiring';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ kind: z.enum(['reschedule', 'cancel']), note: z.string().max(500).optional() }).strict();

/**
 * POST /api/appointments/[id]/request — draft a reschedule or cancel message to the office. Nothing is sent: the
 * patient reviews the draft and approves it at /request/approve, which runs the outbound gate.
 */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeAppointment(req, (await params).id);
  if (!auth.ok) return auth.response;
  const slow = await limited(REQUEST_LIMITS(viewerKeyOrIp(req, auth.viewer)));
  if (slow) return slow;
  try {
    if (!['confirmed', 'proposed'].includes(auth.appt.status)) return json({ reasons: ['not_active'] }, 409);
    const body = bodySchema.parse(await req.json());
    const deps = serviceDeps(req);
    const owner = auth.viewer?.key ?? auth.appt.ownerKey;
    const freeTimes = body.kind === 'reschedule' && deps.sync && owner ? await deps.sync.freeTimes(owner, auth.appt.timezone).catch(() => []) : [];
    const { messageId, draft } = await createRequestDraft(auth.appt, body.kind, requestDeps(), { ...(body.note ? { note: body.note } : {}), freeTimes });
    const updated = await getAppointmentStore().update(auth.appt.id, { requestMessageId: messageId });
    return json({ appointment: updated ? publicAppointment(updated) : null, request: { kind: body.kind, messageId, ...draft } }, 201);
  } catch (error) { return errorResponse(error, 'request'); }
}
