import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { ConsultError, getConsultService } from '@/lib/coordination/consult';
import { consultPatchBodySchema } from '@/lib/coordination/consult/schemas';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; consultId: string }> };

/**
 * PATCH { version, action, subject?, body? } -> { consult }
 * edit (drafted only) | send_to_doctor (patient approves emailing the review link; gated) |
 * consent (after the doctor approved) | send (gated send to the expert) | cancel.
 * Refusals: 422 { error, reasons } with refusal codes only.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const p = await params;
  const id = parseId(p.id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const consultId = parseId(p.consultId);
  if (!consultId) return jsonError(404, 'Request not found');
  const body = await parseBody(req, consultPatchBodySchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({ consult: await getConsultService().patch(id, consultId, body.data) });
  } catch (err) {
    if (err instanceof ConsultError) {
      return NextResponse.json(err.reasons?.length ? { error: err.message, reasons: err.reasons } : { error: err.message }, { status: err.status });
    }
    return jsonError(500, 'Unable to update the consultation request', err);
  }
}
