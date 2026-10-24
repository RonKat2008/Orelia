import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { newDoctorBodySchema } from '@/lib/coordination/contract';
import { ConsultError, getConsultService } from '@/lib/coordination/consult';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/coordination/doctors -> { doctors } */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ doctors: await getConsultService().listDoctors(id) });
  } catch (err) {
    return jsonError(500, 'Unable to load your doctors', err);
  }
}

/** POST { name, practice?, email } -> 201 { doctor } */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, newDoctorBodySchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({ doctor: await getConsultService().addDoctor(id, body.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof ConsultError) return jsonError(err.status, err.message);
    return jsonError(500, 'Unable to save the doctor', err);
  }
}
