import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { verifyCreateBodySchema } from '@/lib/verification/contract';
import { verificationErrorResponse } from '@/lib/verification/http';
import { getVerificationService } from '@/lib/verification/server';
import { jsonError, parseBody, parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/verifications -> { requests, badges } */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json(await (await getVerificationService()).list(id));
  } catch (err) {
    return verificationErrorResponse(err, 'Unable to load verification calls');
  }
}

/** POST /api/cases/[id]/verifications { resourceKey, sharedFields } -> 201 { request } (script preview; nothing is dialed). */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, verifyCreateBodySchema);
  if (!body.ok) return body.response;
  try {
    const { request } = await (await getVerificationService()).create(id, body.data);
    return NextResponse.json({ request }, { status: 201 });
  } catch (err) {
    return verificationErrorResponse(err, 'Unable to prepare the verification call');
  }
}
