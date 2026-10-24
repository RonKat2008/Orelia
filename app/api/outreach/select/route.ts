import { getOutreachHandlers } from '@/lib/outreach/server';
export async function POST(request: Request) { return getOutreachHandlers().select(request); }
