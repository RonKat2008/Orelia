import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { createShareBodySchema, type HistoryShare } from '@/lib/history/contract';
import { getShareStore, shareStatus, signShareToken } from '@/lib/history/share';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const DAY_MS = 86_400_000;

/** GET /api/cases/[id]/history/share -> { shares } with a computed status. Tokens are never stored or returned here. */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const now = new Date();
    const shares = (await getShareStore().list(id)).map(s => ({ ...s, status: shareStatus(s, now) }));
    return NextResponse.json({ shares });
  } catch (err) {
    return jsonError(500, 'Unable to load share links', err);
  }
}

/** POST /api/cases/[id]/history/share -> { share, url }. The url (with the token) is shown once. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, createShareBodySchema);
  if (!body.ok) return body.response;
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.data.expiresInDays * DAY_MS);
    const share: HistoryShare = {
      id: randomUUID(), caseId: id, sections: [...new Set(body.data.sections)], label: body.data.label || null,
      createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), revokedAt: null,
    };
    const token = signShareToken(share.id, expiresAt);
    await getShareStore().create(share);
    const url = `${new URL(req.url).origin}/share/history/${token}`;
    return NextResponse.json({ share, url }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return jsonError(500, 'Unable to create the share link', err);
  }
}
