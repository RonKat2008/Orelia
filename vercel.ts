import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration (compiled to vercel.json by the Vercel CLI).
 *
 * CSP notes: every browser-side request is same-origin (SSE included). The Neon
 * gateway, Exa, AgentMail, AgentCall, PubMed and ClinicalTrials.gov are called
 * from the server only, so none of them may appear in connect-src. next/font
 * self-hosts its Google fonts at build time, so font-src stays 'self'.
 * The one browser-side exception is the medical-document library's direct upload to the PRIVATE Vercel Blob store
 * (https://vercel.com/api/blob/, path-scoped). It carries a short-lived client token minted by our own upload route
 * for exactly one pathname, one content type and 25 MB; nothing is ever read from there by the browser.
 * 'unsafe-inline' scripts are required for Next.js's inline bootstrap (no nonces);
 * 'unsafe-eval' is deliberately omitted.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://vercel.com/api/blob/",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/** Strict env check gates production builds only; other environments just report. */
export const buildCommand =
  'if [ "$VERCEL_ENV" = "production" ]; then npx tsx scripts/check-env.ts --strict; else npx tsx scripts/check-env.ts; fi && next build';

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand,
  // Keep in sync with `export const maxDuration` in each route file.
  functions: {
    "app/api/inngest/route.ts": { maxDuration: 300 },
    "app/api/cases/[id]/stream/route.ts": { maxDuration: 300 },
    "app/api/cases/[id]/research/route.ts": { maxDuration: 300 },
    "app/api/cases/route.ts": { maxDuration: 120 },
    "app/api/cron/follow-ups/route.ts": { maxDuration: 120 },
    "app/api/cron/research-watchdog/route.ts": { maxDuration: 60 },
  },
  // Follow-ups without Inngest: hourly sweep of contacts whose next_follow_up_at has passed.
  // Vercel sends Authorization: Bearer $CRON_SECRET; the route rejects anything else.
  // Research watchdog: ends research whose function died (no agent_runs progress for 6 min) so the UI offers a retry.
  crons: [
    { path: "/api/cron/follow-ups", schedule: "0 * * * *" },
    { path: "/api/cron/research-watchdog", schedule: "*/10 * * * *" },
    // In-app appointment reminders (1 day ahead); no patient email/SMS.
    { path: "/api/cron/appointments", schedule: "15 * * * *" },
  ],
  headers: [{ source: "/(.*)", headers: securityHeaders }],
};

export default config;
