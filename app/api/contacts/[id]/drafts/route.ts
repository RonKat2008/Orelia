import { getOutreachHandlers } from '@/lib/outreach/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return getOutreachHandlers().draft(request, (await context.params).id); }
