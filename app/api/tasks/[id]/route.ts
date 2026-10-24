import { requireTaskOwner } from '@/lib/auth/ownership';
import { getInboxHandlers } from '@/lib/inbox/server';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owner = await requireTaskOwner(request, id);
  if (!owner.ok) return owner.response;
  return getInboxHandlers().get(request, id);
}
