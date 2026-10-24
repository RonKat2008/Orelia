import { rejectCrossOrigin } from '../auth/origin';
import { getOwnerStore, guardCase } from '../auth/ownership';
import { getViewer, type Viewer } from '../auth/viewer';
import { checkRateLimit, clientIp, getRateLimitStore, rateLimitedResponse, type RateRule } from '../rate-limit';
import { getConnectionStore, googleSync } from '../integrations/google/connection';
import { googleConfig } from '../integrations/google/oauth';
import { AppointmentError, type ServiceDeps } from './service';
import { RequestError } from './request';
import type { Appointment } from './schema';
import { getAppointmentStore } from './store';

/** Shared route plumbing for the calendar lane: authorization, rate limits, deps and error mapping. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 60 * 60 * 1000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
export const notFound = () => json({ error: 'Not found' }, 404);

export function appOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.WAYFINDER_APP_ORIGIN?.trim() || env.WAYFINDER_APP_BASE_URL?.trim();
  return (configured || new URL(req.url).origin).replace(/\/$/, '');
}

export function serviceDeps(req: Request): ServiceDeps {
  return {
    store: getAppointmentStore(),
    ...(googleConfig() ? { sync: googleSync({ store: getConnectionStore() }) } : {}),
    appOrigin: appOrigin(req),
  };
}

/**
 * Loads an appointment and enforces case ownership (CSRF first on mutations). A missing appointment and someone
 * else's appointment both answer 404, so ids cannot be probed.
 */
export async function authorizeAppointment(req: Request, id: string): Promise<{ ok: true; appt: Appointment; viewer: Viewer | null } | { ok: false; response: Response }> {
  if (!UUID.test(id)) return { ok: false, response: notFound() };
  let appt: Appointment | undefined;
  try { appt = await getAppointmentStore().get(id); } catch (error) { return { ok: false, response: rejectCrossOrigin(req) ?? errorResponse(error, 'load') }; }
  if (!appt) {
    // Same CSRF answer as for a real id, so a cross-site probe learns nothing.
    return { ok: false, response: rejectCrossOrigin(req) ?? notFound() };
  }
  const denied = await guardCase(req, appt.caseId);
  if (denied) return { ok: false, response: denied };
  return { ok: true, appt, viewer: await getViewer(req) };
}

/**
 * Viewer-scoped routes (all-cases list, feeds, Google): a valid session that owns at least one case. No session, a
 * tampered one, or a session with no cases all get the same opaque 404 (CSRF first on mutations).
 */
export async function requireViewer(req: Request): Promise<{ ok: true; viewer: Viewer } | { ok: false; response: Response }> {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const csrf = rejectCrossOrigin(req);
    if (csrf) return { ok: false, response: csrf };
  }
  try {
    const viewer = await getViewer(req);
    if (!viewer) return { ok: false, response: notFound() };
    const owners = getOwnerStore();
    const hasCase = viewer.kind === 'account' ? ((await owners.casesForAccount?.(viewer.accountId)) ?? []).length > 0 : await owners.ownsAnyCase(viewer.key);
    if (!hasCase) return { ok: false, response: notFound() };
    return { ok: true, viewer };
  } catch (error) { return { ok: false, response: errorResponse(error, 'viewer') }; }
}

export const MUTATION_LIMITS = (key: string): RateRule[] => [{ key: `appointments:write:${key}`, max: 120, windowMs: HOUR }];
export const REQUEST_LIMITS = (key: string): RateRule[] => [{ key: `appointments:request:${key}`, max: 10, windowMs: HOUR }];
export const FEED_LIMITS = (feedId: string): RateRule[] => [{ key: `calendar-feed:${feedId}`, max: 120, windowMs: HOUR }];
export const FEED_CREATE_LIMITS = (key: string): RateRule[] => [{ key: `calendar-feed:create:${key}`, max: 10, windowMs: HOUR }];
export const OAUTH_LIMITS = (key: string, ip: string | null): RateRule[] => [
  { key: `gcal-oauth:${key}`, max: 20, windowMs: HOUR },
  ...(ip ? [{ key: `gcal-oauth:ip:${ip}`, max: 40, windowMs: HOUR }] : []),
];

export async function limited(rules: RateRule[]): Promise<Response | null> {
  const r = await checkRateLimit(getRateLimitStore(), rules, new Date());
  return r.ok ? null : rateLimitedResponse(r.retryAfterSeconds);
}

export function viewerKeyOrIp(req: Request, viewer: Viewer | null): string {
  return viewer?.key ?? `ip:${clientIp(req) ?? 'unknown'}`;
}

export function errorResponse(error: unknown, label: string): Response {
  if (error instanceof AppointmentError || error instanceof RequestError) return json({ reasons: error.reasons }, error.status);
  if (error && typeof error === 'object' && 'issues' in error) return json({ reasons: ['invalid_request'] }, 400);
  if (error instanceof SyntaxError) return json({ reasons: ['invalid_request'] }, 400);
  console.error(`[appointments] ${label} failed:`, error instanceof Error ? error.name : 'unknown');
  return json({ reasons: ['appointments_unavailable'] }, 503);
}

/** Public-facing shape (never exposes owner keys or Google event ids). */
export function publicAppointment(a: Appointment) {
  const rest: Omit<Appointment, 'ownerKey' | 'googleEventId'> & { ownerKey?: unknown; googleEventId?: unknown } = { ...a };
  delete rest.ownerKey;
  delete rest.googleEventId;
  return { ...(rest as Omit<Appointment, 'ownerKey' | 'googleEventId'>), syncedToGoogle: !!a.googleEventId };
}
export type PublicAppointment = ReturnType<typeof publicAppointment>;
