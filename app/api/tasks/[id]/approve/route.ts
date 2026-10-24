import { getInboxHandlers } from '@/lib/inbox/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return getInboxHandlers().approve(request, (await context.params).id); }
