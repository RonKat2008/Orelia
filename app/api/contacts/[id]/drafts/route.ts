import { guardContact } from '@/lib/auth/ownership';
import { getOutreachHandlers } from '@/lib/outreach/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const denied = await guardContact(request, id);
  if (denied) return denied;
  return getOutreachHandlers().draft(request, id);
}
