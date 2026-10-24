import { timingSafeEqual } from 'node:crypto';
import { sweepReminders } from '@/lib/appointments/service';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || !secret.trim()) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GET /api/cron/appointments — hourly: in-app reminders for confirmed appointments starting within a day. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorized(request, process.env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: 'database_not_configured' }, { status: 503, headers });
  try {
    return Response.json({ ok: true, ...(await sweepReminders(getAppointmentStore())) }, { headers });
  } catch (error) {
    console.error('[cron/appointments] sweep failed', error instanceof Error ? error.name : 'error');
    return Response.json({ ok: false, error: 'sweep_failed' }, { status: 500, headers });
  }
}
