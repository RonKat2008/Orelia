import { appOrigin, authorizeAppointment, errorResponse } from '@/lib/appointments/http';
import { singleEventIcs } from '@/lib/appointments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/appointments/[id]/ics — one .ics file for Apple Calendar, Outlook or Google import. Owner only. */
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authorizeAppointment(req, (await params).id);
  if (!auth.ok) return auth.response;
  if (!auth.appt.startsAt) return Response.json({ reasons: ['no_time'] }, { status: 422 });
  try {
    const origin = appOrigin(req);
    const body = singleEventIcs(auth.appt, { now: new Date(), uidDomain: new URL(origin).host, appOrigin: origin });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="appointment-${auth.appt.id.slice(0, 8)}.ics"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) { return errorResponse(error, 'ics'); }
}
