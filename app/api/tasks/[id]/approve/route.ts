import { guardTask } from '@/lib/auth/ownership';
import { getInboxHandlers } from '@/lib/inbox/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const denied = await guardTask(request, id);
  if (denied) return denied;
  return getInboxHandlers().approve(request, id);
}
