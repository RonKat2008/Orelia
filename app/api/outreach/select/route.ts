import { rejectCrossOrigin } from '@/lib/auth/origin';
import { requireCaseOwner } from '@/lib/auth/ownership';
import { getOutreachHandlers } from '@/lib/outreach/server';
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  // Body is read once here to find the case, then replayed to the validated handler.
  const text = await request.text();
  let caseId: unknown;
  try { caseId = (JSON.parse(text) as { caseId?: unknown } | null)?.caseId; } catch { caseId = undefined; }
  if (typeof caseId === 'string') {
    const owner = await requireCaseOwner(request, caseId);
    if (!owner.ok) return owner.response;
  } else {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return getOutreachHandlers().select(new Request(request.url, { method: request.method, headers: request.headers, body: text }));
}
