import { getInboxHandlers } from '@/lib/inbox/server';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return getInboxHandlers().get(request, (await context.params).id); }
