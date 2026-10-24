import { createHash, randomBytes } from 'node:crypto';
import { open, seal } from '../../crypto/token-box';

/**
 * Google Calendar OAuth 2.0 (authorization code + PKCE S256 + state). Scopes are incremental: calendar.events
 * first, calendar.freebusy only when the patient separately opts in. The pending flow (state, PKCE verifier, viewer)
 * lives in a short-lived HttpOnly cookie sealed with AES-GCM, so the browser cannot read or forge it.
 */
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';
export const OAUTH_COOKIE = 'wf_gcal_oauth';
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

type Env = Record<string, string | undefined>;

export interface GoogleConfig { clientId: string; clientSecret: string }

/** Null when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set: the UI then shows Google as unavailable. */
export function googleConfig(env: Env = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(requestUrl: string, env: Env = process.env): string {
  const configured = env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) return configured;
  return `${new URL(requestUrl).origin}/api/integrations/google/callback`;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface PendingFlow { state: string; verifier: string; viewerKey: string; scopes: string[]; returnTo: string; exp: number }

export function startFlow(viewerKey: string, scopes: string[], returnTo: string, now: Date, env: Env = process.env): { flow: PendingFlow; cookieValue: string; challenge: string } {
  const { verifier, challenge } = pkcePair();
  const flow: PendingFlow = { state: randomBytes(24).toString('base64url'), verifier, viewerKey, scopes, returnTo: safeReturnTo(returnTo), exp: now.getTime() + OAUTH_TTL_MS };
  return { flow, cookieValue: seal(JSON.stringify(flow), 'gcal-oauth-flow', env), challenge };
}

/** Only same-site relative paths; anything else returns to the calendar settings page. */
export function safeReturnTo(path: string | null | undefined): string {
  return path && /^\/(?!\/)[\w\-/]*$/.test(path) ? path : '/calendar';
}

export type FlowCheck = { ok: true; flow: PendingFlow } | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'state_mismatch' | 'viewer_mismatch' };

export function checkFlow(cookieValue: string | null | undefined, state: string | null, viewerKey: string | null, now: Date, env: Env = process.env): FlowCheck {
  if (!cookieValue) return { ok: false, reason: 'missing' };
  let flow: PendingFlow;
  try { flow = JSON.parse(open(cookieValue, 'gcal-oauth-flow', env)) as PendingFlow; } catch { return { ok: false, reason: 'invalid' }; }
  if (typeof flow.exp !== 'number' || flow.exp < now.getTime()) return { ok: false, reason: 'expired' };
  if (!state || state !== flow.state) return { ok: false, reason: 'state_mismatch' };
  if (!viewerKey || viewerKey !== flow.viewerKey) return { ok: false, reason: 'viewer_mismatch' };
  return { ok: true, flow };
}

export function authorizationUrl(cfg: GoogleConfig, opts: { redirectUri: string; scopes: string[]; state: string; challenge: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: opts.scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

export interface TokenResponse { accessToken: string; expiresAt: Date; refreshToken?: string; scopes: string[] }

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch, now: Date): Promise<TokenResponse> {
  const res = await fetcher(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`Google token endpoint returned ${res.status}`);
  const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; scope?: unknown };
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') throw new Error('Malformed Google token response');
  return {
    accessToken: json.access_token,
    expiresAt: new Date(now.getTime() + json.expires_in * 1000),
    ...(typeof json.refresh_token === 'string' ? { refreshToken: json.refresh_token } : {}),
    scopes: typeof json.scope === 'string' ? json.scope.split(' ').filter(Boolean) : [],
  };
}

export function exchangeCode(cfg: GoogleConfig, code: string, verifier: string, redirect: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }), fetcher, now);
}

export function refreshAccess(cfg: GoogleConfig, refreshToken: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }), fetcher, now);
}

export async function revokeToken(token: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(REVOKE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
}
