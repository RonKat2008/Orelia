/** Exact exceptions only. Never add case-data routes to make an ownership test pass. */
export const publicRoutes: Record<string, { methods: readonly string[]; protection: string }> = {
  '/api/health': { methods: ['GET'], protection: 'Deployment readiness; intentionally public, no case data.' },
  '/api/inngest': { methods: ['GET', 'POST', 'PUT'], protection: 'Inngest SDK signing protocol, not browser session authentication.' },
  '/api/webhooks/agentmail': { methods: ['POST'], protection: 'AgentMail Svix signature over raw payload.' },
  '/api/webhooks/agentcall': { methods: ['POST'], protection: 'AgentCall HMAC signature over raw payload.' },
};
/** Creates a new owned resource; no existing case to authorize. CSRF still required. */
export const creationRoutes = new Set(['/api/cases:POST']);
