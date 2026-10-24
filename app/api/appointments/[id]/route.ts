import { z } from 'zod';
import { authorizeAppointment, errorResponse, json, limited, MUTATION_LIMITS, publicAppointment, serviceDeps, viewerKeyOrIp } from '@/lib/appointments/http';
import { confirmInputSchema, prepNotesSchema } from '@/lib/appointments/schema';
import { confirm, dismiss, markCancelled, markDone, updatePrep } from '@/lib/appointments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), input: confirmInputSchema }).strict(),
  z.object({ action: z.literal('dismiss') }).strict(),
  z.object({ action: z.literal('done') }).strict(),
  z.object({ action: z.literal('cancelled') }).strict(),
  z.object({ action: z.literal('prep'), prep: prepNotesSchema }).strict(),
]);

export async function GET(req: Request, { params }: Ctx) {
  const auth = await authorizeAppointment(req, (await params).id);
  if (!auth.ok) return auth.response;
  return json({ appointment: publicAppointment(auth.appt) });
}

/** POST /api/appointments/[id] — confirm a proposed time, dismiss it, mark done/cancelled, or save prep notes. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeAppointment(req, (await params).id);
  if (!auth.ok) return auth.response;
  const slow = await limited(MUTATION_LIMITS(viewerKeyOrIp(req, auth.viewer)));
  if (slow) return slow;
  try {
    const body = actionSchema.parse(await req.json());
    const deps = serviceDeps(req);
    const owner = auth.viewer?.key ?? auth.appt.ownerKey;
    const appointment =
      body.action === 'confirm' ? await confirm(deps, auth.appt, owner, body.input)
      : body.action === 'dismiss' ? await dismiss(deps, auth.appt)
      : body.action === 'done' ? await markDone(deps, auth.appt)
      : body.action === 'cancelled' ? await markCancelled(deps, auth.appt, owner)
      : await updatePrep(deps, auth.appt, owner, body.prep);
    return json({ appointment: publicAppointment(appointment) });
  } catch (error) { return errorResponse(error, 'update'); }
}
