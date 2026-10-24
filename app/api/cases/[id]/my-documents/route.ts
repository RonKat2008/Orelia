import { requireCaseOwner } from '@/lib/auth/ownership';
import { searchCaseLibrary } from '@/lib/accounts/case-link';
import { fail, json } from '@/lib/accounts/http';
import { parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/my-documents?q=&k= -> { available, results } from the library of the account that owns the case. */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return fail(400, 'invalid_case');
  const access = await requireCaseOwner(req, id);
  if (!access.ok) return access.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 500);
  if (!q) return fail(400, 'invalid_query', 'Add a search query');
  const k = Number(url.searchParams.get('k') ?? 5);
  try {
    return json(await searchCaseLibrary(id, q, Number.isFinite(k) ? Math.min(10, k) : 5));
  } catch (err) {
    return fail(500, 'search_failed', undefined, err);
  }
}
