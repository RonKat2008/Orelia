import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { buildBoard } from '@/lib/coordination/board';
import { getBoardDeps } from '@/lib/coordination/board-deps';
import { jsonError, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/coordination/board -> { board } (derived on every read, never stored). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ board: await buildBoard(id, getBoardDeps()) });
  } catch (err) {
    return jsonError(500, 'Unable to build the next steps board', err);
  }
}
