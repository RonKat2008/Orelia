import type { VercelConfig } from "@vercel/config/v1";
import { BROWSER_CALL_SOURCES, DEFAULT_HEADERS_SOURCE } from "./lib/live/browser-call-scope";

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

/**
 * DEMO "take the call in your browser" (components/live/BrowserCallButton.tsx) runs on the live console. Its pages
 * (/demo and /cases/*, see lib/live/browser-call-scope.ts) may load Daily's call machine (c.daily.co), talk to Daily/Vapi realtime servers
 * and use the microphone. Daily's always-on Krisp noise filter needs 'wasm-unsafe-eval' (WebAssembly compile only, not
 * JS eval) and a blob: audio worklet; without them the mic track never reaches Vapi (verified in Chrome).
 * Every other page keeps the policy above and microphone=().
 */
export const KERNEL_LIVE_VIEW_FRAME_SRC = "https://*.onkernel.com https://*.onkernel.com:8443 https://*.kernel.sh:8443";
export const BROWSER_CALL_ORIGINS = { frame: KERNEL_LIVE_VIEW_FRAME_SRC, script: "'wasm-unsafe-eval' https://c.daily.co blob:", connect: "https://*.daily.co wss://*.daily.co https://api.vapi.ai https://*.vapi.ai wss://*.vapi.ai" };
export const browserCallContentSecurityPolicy = contentSecurityPolicy
  .replace("script-src 'self' 'unsafe-inline'", `script-src 'self' 'unsafe-inline' ${BROWSER_CALL_ORIGINS.script}`)
  .replace("connect-src 'self' https://vercel.com/api/blob/", `connect-src 'self' https://vercel.com/api/blob/ ${BROWSER_CALL_ORIGINS.connect}`)
  .concat(`; frame-src ${BROWSER_CALL_ORIGINS.frame}`)
  .concat("; media-src 'self' blob:; worker-src 'self' blob:");

export { BROWSER_CALL_SOURCES, DEFAULT_HEADERS_SOURCE };

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

/** Same headers, with the browser-call CSP and microphone=(self) (see browserCallContentSecurityPolicy). */
export const browserCallHeaders = securityHeaders.map((h) =>
  h.key === "Content-Security-Policy" ? { ...h, value: browserCallContentSecurityPolicy }
    : h.key === "Permissions-Policy" ? { ...h, value: h.value.replace("microphone=()", "microphone=(self)") } : h);

/** Strict env check gates production builds only; other environments just report. */
export const buildCommand =
  'if [ "$VERCEL_ENV" = "production" ]; then npx tsx scripts/check-env.ts --strict; else npx tsx scripts/check-env.ts; fi && next build';

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand,
  // Functions run next to the Neon database (us-east-1 = iad1). Measured: prod already resolved to iad1, so this pins
  // it explicitly; a function in another region would pay a cross-region round trip on every one of a page's queries.
  regions: ["iad1"],
  // Keep in sync with `export const maxDuration` in each route file.
  functions: {
    "app/api/inngest/route.ts": { maxDuration: 300 },
    "app/api/cases/[id]/stream/route.ts": { maxDuration: 300 },
    "app/api/cases/[id]/activity/stream/route.ts": { maxDuration: 300 },
    "app/api/cases/[id]/research/route.ts": { maxDuration: 300 },
    "app/api/cases/route.ts": { maxDuration: 120 },
    "app/api/cron/follow-ups/route.ts": { maxDuration: 120 },
    "app/api/cron/research-watchdog/route.ts": { maxDuration: 60 },
    "app/api/cases/[id]/demo-live/route.ts": { maxDuration: 120 },
    "app/api/demo/live/start/route.ts": { maxDuration: 60 },
  },
  // The cron tick, every minute (Pro plan minimum): follow-ups whose next_follow_up_at has passed, demo coordinator
  // replies (demo mode only) and due resource agents. Every step leases its rows, so overlapping runs never double-send.
  // Vercel sends Authorization: Bearer $CRON_SECRET; the route rejects anything else.
  // Research watchdog: ends research whose function died (no agent_runs progress for 6 min) so the UI offers a retry.
  crons: [
    { path: "/api/cron/follow-ups", schedule: "* * * * *" },
    { path: "/api/cron/research-watchdog", schedule: "*/10 * * * *" },
    // In-app appointment reminders (1 day ahead); no patient email/SMS.
    { path: "/api/cron/appointments", schedule: "15 * * * *" },
  ],
  headers: [
    { source: DEFAULT_HEADERS_SOURCE, headers: securityHeaders },
    ...BROWSER_CALL_SOURCES.map((source) => ({ source, headers: browserCallHeaders })),
  ],
};

export default config;
