import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { getPacketDeps } from '@/lib/coordination/packet/deps';
import { attachBodySchema } from '@/lib/coordination/packet/http';
import { attachPacket } from '@/lib/coordination/packet/service';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** POST { resourceKey, contactId } -> { draftId }. Appends the included sections to the pending, unapproved draft. Sends nothing. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, attachBodySchema);
  if (!body.ok) return body.response;
  try {
    const r = await attachPacket(id, body.data.resourceKey, body.data.contactId, getPacketDeps());
    return r.ok ? NextResponse.json(r.value) : jsonError(r.status, r.error);
  } catch (err) {
    return jsonError(500, 'Unable to attach the packet', err);
  }
}
