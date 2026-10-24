import { rejectCrossOrigin } from '@/lib/auth/origin';
import { getViewer } from '@/lib/auth/viewer';
import { appOrigin, errorResponse, FEED_CREATE_LIMITS, json, limited } from '@/lib/appointments/http';
import { signFeedToken, type FeedRow } from '@/lib/appointments/feed';
import { getAppointmentStore } from '@/lib/appointments/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(req: Request, f: FeedRow) {
  const https = `${appOrigin(req)}/api/calendar/feed/${signFeedToken(f.id)}.ics`;
  return { id: f.id, createdAt: f.createdAt, revokedAt: f.revokedAt, ...(f.revokedAt ? {} : { url: https, webcalUrl: https.replace(/^https?:/, 'webcal:') }) };
}

/** GET /api/calendar/feeds — the viewer's private subscription feeds (live ones carry their URL). */
export async function GET(req: Request) {
  const viewer = getViewer(req);
  if (!viewer) return json({ feeds: [] });
  try {
    const feeds = await getAppointmentStore().feeds(viewer.key);
    return json({ feeds: feeds.map(f => view(req, f)) });
  } catch (error) { return errorResponse(error, 'feeds'); }
}

/** POST /api/calendar/feeds — mint a new private feed URL. */
export async function POST(req: Request) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const viewer = getViewer(req);
  if (!viewer) return json({ reasons: ['no_session'] }, 401);
  const slow = await limited(FEED_CREATE_LIMITS(viewer.key));
  if (slow) return slow;
  try {
    const store = getAppointmentStore();
    if ((await store.feeds(viewer.key)).filter(f => !f.revokedAt).length >= 3) return json({ reasons: ['too_many_feeds'] }, 409);
    const feed = await store.createFeed(viewer.key);
    return json({ feed: view(req, feed) }, 201);
  } catch (error) { return errorResponse(error, 'feed-create'); }
}
