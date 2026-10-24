import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { loadTimeline, removeRecord } from '@/lib/history/ingest';
import { jsonError, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** DELETE /api/cases/[id]/history/documents/[docId] -> { timeline } | 404 */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id: rawId, docId: rawDoc } = await params;
  const id = parseId(rawId);
  if (!id) return jsonError(400, 'Invalid id');
  // Ownership + same-origin first, so nothing about the case leaks through sub-id validation.
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const docId = parseId(rawDoc);
  if (!docId) return jsonError(400, 'Invalid id');
  try {
    if (!(await removeRecord(id, docId))) return jsonError(404, 'Record not found');
    return NextResponse.json({ timeline: await loadTimeline(id) });
  } catch (err) {
    return jsonError(500, 'Unable to delete the record', err);
  }
}
