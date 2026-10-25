/** Exact exceptions only. Never add case-data routes to make an ownership test pass. */
export const publicRoutes: Record<string, { methods: readonly string[]; protection: string }> = {
  '/api/health': { methods: ['GET'], protection: 'Deployment readiness; intentionally public, no case data.' },
  '/api/cron/follow-ups': { methods: ['GET'], protection: 'Vercel Cron: Authorization: Bearer CRON_SECRET (constant-time compare, fails closed when unset); no case data in the response.' },
  '/api/cron/research-watchdog': { methods: ['GET'], protection: 'Vercel Cron: Authorization: Bearer CRON_SECRET (constant-time compare, fails closed when unset); returns only counts and case ids it ended.' },
  '/api/inngest': { methods: ['GET', 'POST', 'PUT'], protection: 'Inngest SDK signing protocol, not browser session authentication.' },
  '/api/webhooks/agentmail': { methods: ['POST'], protection: 'AgentMail Svix signature over raw payload.' },
  '/api/review/[token]': { methods: ['GET', 'POST'], protection: 'Doctor review capability: HMAC-signed random token, only its sha256 stored, expiring and single-decision; returns only that consult request; POST same-origin checked and rate limited.' },
  '/api/webhooks/agentcall': { methods: ['POST'], protection: 'AgentCall HMAC signature over raw payload.' },
  '/api/webhooks/vapi': { methods: ['POST'], protection: 'Vapi shared secret (x-vapi-secret or Bearer), constant-time compare, fail closed; only calls Wayfinder placed.' },
  '/api/demo-intake/[resource]': { methods: ['POST'], protection: 'Demo mode only (404 otherwise); HMAC token binding case + application + resource; records only for an approved application of that case. Posted by the Kernel cloud browser, which has no session.' },
  '/api/auth/[...path]': { methods: ['GET', 'POST'], protection: 'Neon Auth (Better Auth) proxy: sign-up/sign-in/OAuth/password reset; its own CSRF and trusted-origin checks plus our same-origin check on POST; 404 when accounts are not configured; no case data.' },
  '/api/account': { methods: ['GET', 'DELETE'], protection: 'GET reports only whether accounts are enabled and who is signed in (null when signed out); DELETE requires same-origin, the signed-in account and confirm:"DELETE", and only touches that account.' },
  '/api/account/sign-out': { methods: ['POST'], protection: 'Same-origin only; ends the caller\'s own sessions and clears the anonymous cookie; no data returned.' },
  '/api/cron/appointments': { methods: ['GET'], protection: 'Vercel Cron: Authorization: Bearer CRON_SECRET (constant-time compare, fails closed when unset); writes in-app reminder marks, returns only counts.' },
  '/api/calendar/feed/[token]': { methods: ['GET'], protection: 'Private calendar subscription capability: HMAC-signed feed id (WAYFINDER_TOKEN_KEY subkey), revocable, rate limited per feed; 404 for any bad or revoked token. Fetched by calendar apps, which have no session.' },
  '/api/integrations/google/callback': { methods: ['GET'], protection: 'Google OAuth redirect: 404 unless Google is configured; requires the AES-GCM sealed, 10-minute flow cookie whose state AND viewer session must both match before the PKCE code exchange; returns only a same-site redirect.' },
};
/** Routes whose response is a status probe with no storage behind it (the storage-failure probe expects < 400). */
export const statusOnlyRoutes = new Set(['/api/health', '/api/account:GET', '/api/account/sign-out:POST', '/api/cases/[id]/space/usage:GET', '/api/cases/[id]/space/adopt:POST']);
/** Creates a new owned resource; no existing case to authorize. CSRF still required. */
export const creationRoutes = new Set(['/api/cases:POST']);
