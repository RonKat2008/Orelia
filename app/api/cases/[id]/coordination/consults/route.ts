import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { ConsultError, getConsultService } from '@/lib/coordination/consult';
import { newConsultBodySchema } from '@/lib/coordination/consult/schemas';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const refusal = (err: ConsultError) =>
  NextResponse.json(err.reasons?.length ? { error: err.message, reasons: err.reasons } : { error: err.message }, { status: err.status });

/** GET -> { consults } (review token hashes stripped) */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ consults: await getConsultService().listConsults(id) });
  } catch (err) {
    return jsonError(500, 'Unable to load consultation requests', err);
  }
}

/** POST { resourceKey, doctorId, packetId?, sharedFields } -> 201 { consult }. Drafts only; nothing is sent. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, newConsultBodySchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({ consult: await getConsultService().create(id, body.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof ConsultError) return refusal(err);
    return jsonError(500, 'Unable to draft the consultation request', err);
  }
}
