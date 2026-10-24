import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { getApplicationStore } from '@/lib/web-application/store';
import { jsonError, parseId } from '../../_lib/http';
import { getServices } from '../../_lib/services';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/applications -> drafted online applications for the outbox "Review application" cards. */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    if (!await getServices().cases.get(id)) return jsonError(404, 'Case not found');
    const applications = await getApplicationStore().listByCase(id);
    return NextResponse.json({ applications });
  } catch (err) {
    return jsonError(500, 'Unable to load applications', err);
  }
}
