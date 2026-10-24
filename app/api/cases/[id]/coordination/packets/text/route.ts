import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { resourceKeySchema } from '@/lib/coordination/contract';
import { getPacketDeps } from '@/lib/coordination/packet/deps';
import { packetText } from '@/lib/coordination/packet/service';
import { jsonError, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET ...?resourceKey= -> { text } (included sections only). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const key = resourceKeySchema.safeParse(new URL(req.url).searchParams.get('resourceKey'));
  if (!key.success) return jsonError(400, 'Invalid body', undefined, ['resourceKey']);
  try {
    const r = await packetText(id, key.data, getPacketDeps());
    return r.ok ? NextResponse.json({ text: r.value }) : jsonError(r.status, r.error);
  } catch (err) {
    return jsonError(500, 'Unable to render the packet', err);
  }
}
