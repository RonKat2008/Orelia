import { NextResponse } from 'next/server';
import { patientNoteSchema } from '@/lib/contracts/case-docs';
import { getDocumentStore, ingest } from '@/lib/case-docs';
import { metadata } from '@/lib/case-docs/store';
import { jsonError, parseBody, parseId } from '../../_lib/http';
import { getServices } from '../../_lib/services';
import { guardCase } from '@/lib/auth/ownership';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    if (!await getServices().cases.get(id)) return jsonError(404, 'Case not found');
    return NextResponse.json({ documents: await getDocumentStore().list(id) });
  } catch (error) {
    console.error('Document list failed', error);
    return jsonError(500, 'Unable to load documents');
  }
}
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, patientNoteSchema);
  if (!body.ok) return body.response;
  try {
    if (!await getServices().cases.get(id)) return jsonError(404, 'Case not found');
    const rows = await ingest({ caseId: id, kind: 'patient_note', ...body.data });
    return NextResponse.json({ documents: rows.map(metadata) }, { status: 201 });
  } catch (error) {
    console.error('Document ingest failed', error);
    return jsonError(500, 'Unable to save document');
  }
}
