import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { getPacketDeps } from '@/lib/coordination/packet/deps';
import { buildBodySchema, patchBodySchema } from '@/lib/coordination/packet/http';
import { buildPacket, patchPacket } from '@/lib/coordination/packet/service';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/coordination/packets -> { packets } */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ packets: await getPacketDeps().store.list(id, 'packet') });
  } catch (err) {
    return jsonError(500, 'Unable to load packets', err);
  }
}

/** POST { resourceKey } -> 201 { packet }. Rebuilds from the patient's history; keeps previous ticks and questions. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, buildBodySchema);
  if (!body.ok) return body.response;
  try {
    const r = await buildPacket(id, body.data.resourceKey, getPacketDeps());
    return r.ok ? NextResponse.json({ packet: r.value }, { status: 201 }) : jsonError(r.status, r.error);
  } catch (err) {
    return jsonError(500, 'Unable to build the packet', err);
  }
}

/** PATCH { resourceKey, version, included?, questions? } -> { packet }; 409 when the version is stale. */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, patchBodySchema);
  if (!body.ok) return body.response;
  try {
    const { resourceKey, ...patch } = body.data;
    const r = await patchPacket(id, resourceKey, patch, getPacketDeps());
    return r.ok ? NextResponse.json({ packet: r.value }) : jsonError(r.status, r.error);
  } catch (err) {
    return jsonError(500, 'Unable to update the packet', err);
  }
}
