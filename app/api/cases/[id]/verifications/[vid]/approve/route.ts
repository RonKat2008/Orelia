import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardCase } from '@/lib/auth/ownership';
import { verificationErrorResponse } from '@/lib/verification/http';
import { getVerificationService } from '@/lib/verification/server';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; vid: string }> };

/** POST /api/cases/[id]/verifications/[vid]/approve {} -> sets approvedAt, runs checkOutbound, places the call. */
export async function POST(req: Request, { params }: Ctx) {
  const p = await params;
  const id = parseId(p.id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const vid = parseId(p.vid);
  if (!vid) return jsonError(404, 'Verification request not found');
  const body = await parseBody(req, z.object({}).strict());
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({ request: await (await getVerificationService()).approve(id, vid) });
  } catch (err) {
    return verificationErrorResponse(err, 'Unable to place the verification call');
  }
}
