import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { getShareStore } from '@/lib/history/share';
import { jsonError, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; shareId: string }> };

/** DELETE /api/cases/[id]/history/share/[shareId] -> revoke the link (404 when it is not this case's). */
export async function DELETE(req: Request, { params }: Ctx) {
  const raw = await params;
  const id = parseId(raw.id);
  if (!id) return jsonError(400, 'Invalid id');
  // Ownership + same-origin first, so nothing about the case leaks through sub-id validation.
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const shareId = parseId(raw.shareId);
  if (!shareId) return jsonError(400, 'Invalid id');
  try {
    const share = await getShareStore().revoke(id, shareId, new Date());
    return share ? NextResponse.json({ share }) : jsonError(404, 'Share link not found');
  } catch (err) {
    return jsonError(500, 'Unable to revoke the share link', err);
  }
}
