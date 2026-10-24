import { getViewer } from '@/lib/auth/viewer';
import { checkFlow, exchangeCode, googleConfig, OAUTH_COOKIE, redirectUri, SCOPE_EVENTS } from '@/lib/integrations/google/oauth';
import { connectionFromTokens, getConnectionStore } from '@/lib/integrations/google/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** GET /api/integrations/google/callback — verifies state + viewer, exchanges the code with the PKCE verifier. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clear = `${OAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/integrations/google; Max-Age=0`;
  const back = (path: string, reason: string) => new Response(null, { status: 303, headers: { Location: new URL(`${path}?google=${reason}`, url.origin).toString(), 'Set-Cookie': clear, 'Cache-Control': 'no-store' } });
  const cfg = googleConfig();
  if (!cfg) return back('/calendar', 'unavailable');
  const viewer = getViewer(req);
  const check = checkFlow(cookie(req, OAUTH_COOKIE), url.searchParams.get('state'), viewer?.key ?? null, new Date());
  if (!check.ok) return back('/calendar', 'invalid_state');
  if (url.searchParams.get('error')) return back(check.flow.returnTo, 'declined');
  const code = url.searchParams.get('code');
  if (!code) return back(check.flow.returnTo, 'invalid_state');
  try {
    const tokens = await exchangeCode(cfg, code, check.flow.verifier, redirectUri(req.url));
    if (!tokens.scopes.includes(SCOPE_EVENTS)) return back(check.flow.returnTo, 'scope_missing');
    const store = getConnectionStore();
    await store.save(connectionFromTokens(check.flow.viewerKey, tokens, await store.get(check.flow.viewerKey)));
    return back(check.flow.returnTo, 'connected');
  } catch (error) {
    console.error('[google-oauth] exchange failed:', error instanceof Error ? error.name : 'unknown');
    return back(check.flow.returnTo, 'failed');
  }
}
