import { getOutreachHandlers } from '@/lib/outreach/server';
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { return getOutreachHandlers().consent(request, (await context.params).id); }
