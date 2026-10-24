import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { searchQuerySchema } from '@/lib/history/contract';
import { searchHistory } from '@/lib/history/search';
import { fieldPaths, jsonError, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/history/search?q=&k= -> { results } */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const url = new URL(req.url);
  const k = url.searchParams.get('k');
  const query = searchQuerySchema.safeParse({ q: url.searchParams.get('q') ?? '', ...(k === null ? {} : { k }) });
  if (!query.success) return jsonError(400, 'Invalid search', undefined, fieldPaths(query.error));
  try {
    return NextResponse.json({ results: await searchHistory(id, query.data.q, query.data.k) });
  } catch (err) {
    return jsonError(500, 'Unable to search the medical history', err);
  }
}
