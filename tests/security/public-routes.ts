/** Exact exceptions only. Never add case-data routes to make an ownership test pass. */
export const publicRoutes: Record<string, { methods: readonly string[]; protection: string }> = {
  '/api/health': { methods: ['GET'], protection: 'Deployment readiness; intentionally public, no case data.' },
  '/api/cron/follow-ups': { methods: ['GET'], protection: 'Vercel Cron: Authorization: Bearer CRON_SECRET (constant-time compare, fails closed when unset); no case data in the response.' },
  '/api/inngest': { methods: ['GET', 'POST', 'PUT'], protection: 'Inngest SDK signing protocol, not browser session authentication.' },
  '/api/webhooks/agentmail': { methods: ['POST'], protection: 'AgentMail Svix signature over raw payload.' },
  '/api/review/[token]': { methods: ['GET', 'POST'], protection: 'Doctor review capability: HMAC-signed random token, only its sha256 stored, expiring and single-decision; returns only that consult request; POST same-origin checked and rate limited.' },
  '/api/webhooks/agentcall': { methods: ['POST'], protection: 'AgentCall HMAC signature over raw payload.' },
};
/** Creates a new owned resource; no existing case to authorize. CSRF still required. */
export const creationRoutes = new Set(['/api/cases:POST']);
