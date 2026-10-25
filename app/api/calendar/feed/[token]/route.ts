import { appOrigin, FEED_LIMITS, limited } from '@/lib/appointments/http';
import { feedIsLive, verifyFeedToken } from '@/lib/appointments/feed';
import { feedIcs } from '@/lib/appointments/service';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ token: string }> };

/** A malformed %-escape in the URL is just an unknown feed, not a server error. */
function decodeToken(raw: string): string | null {
  try { return decodeURIComponent(raw); } catch { return null; }
}

const missing = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET /api/calendar/feed/<id>.<sig>.ics — private, signed, revocable ICS subscription (Apple Calendar, Outlook,
 * Google "From URL"). No cookie: the signed token is the credential. Event text never includes the diagnosis.
 */
export async function GET(req: Request, { params }: Ctx) {
  const token = decodeToken((await params).token);
  const feedId = token ? verifyFeedToken(token) : null;
  if (!feedId) return missing();
  try {
    const store = getAppointmentStore();
    const feed = await store.feed(feedId);
    if (!feedIsLive(feed)) return missing();
    const slow = await limited(FEED_LIMITS(feedId));
    if (slow) return slow;
    const now = new Date();
    const appointments = await store.listForOwner(feed.ownerKey);
    await store.touchFeed(feedId, now).catch(() => undefined);
    const origin = appOrigin(req);
    return new Response(feedIcs(appointments, { now, uidDomain: new URL(origin).host, appOrigin: origin }), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="orelia.ics"',
        'Cache-Control': 'private, no-cache', // revalidate every fetch so a revoked feed stops at once
        'X-Robots-Tag': 'noindex',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error('[calendar-feed] failed:', error instanceof Error ? error.name : 'unknown');
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
