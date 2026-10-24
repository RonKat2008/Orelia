import { limited, notFound, OAUTH_LIMITS, requireViewer } from '@/lib/appointments/http';
import { clientIp } from '@/lib/rate-limit';
import { hasTokenKey } from '@/lib/crypto/token-box';
import { authorizationUrl, googleConfig, OAUTH_COOKIE, OAUTH_TTL_MS, redirectUri, SCOPE_EVENTS, SCOPE_FREEBUSY, startFlow } from '@/lib/integrations/google/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/google/connect?scope=events|freebusy — starts Google OAuth (PKCE + state). Reached by a
 * plain link, so no form post is redirected off-site. Free/busy is a separate, later opt-in (incremental consent).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await requireViewer(req);
  if (!auth.ok) return auth.response;
  const { viewer } = auth;
  const cfg = googleConfig();
  // Not configured on this deployment: the route does not exist (the UI only links here when status says available).
  if (!cfg || !hasTokenKey()) return notFound();
  const slow = await limited(OAUTH_LIMITS(viewer.key, clientIp(req)));
  if (slow) return slow;
  const scopes = url.searchParams.get('scope') === 'freebusy' ? [SCOPE_EVENTS, SCOPE_FREEBUSY] : [SCOPE_EVENTS];
  const { flow, cookieValue, challenge } = startFlow(viewer.key, scopes, url.searchParams.get('returnTo') ?? '/calendar', new Date());
  const location = authorizationUrl(cfg, { redirectUri: redirectUri(req.url), scopes, state: flow.state, challenge });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': `${OAUTH_COOKIE}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/api/integrations/google; Max-Age=${OAUTH_TTL_MS / 1000}${secure}`,
      'Cache-Control': 'no-store',
    },
  });
}
