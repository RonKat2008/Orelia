import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/origin";
import { ensureSession } from "@/lib/auth/session";
import { liveDemoEnabled, startLiveDemo } from "@/lib/demo-live/start";
import { checkRateLimit, clientIp, getRateLimitStore, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
/** A demo case per click; bounded so a loop cannot fill the database. */
const START_LIMIT = 12;

/**
 * POST /api/demo/live/start -> { caseId, ... }. DEMO MODE ONLY (404 otherwise). Seeds the synthetic vEDS case with
 * four fictional resources (email, call, online form, email-then-call), owned by the caller's session, then selects,
 * consents (default fields) and builds the plan. Approves and sends NOTHING.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  if (!liveDemoEnabled(process.env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = ensureSession(request);
  try {
    const limit = await checkRateLimit(getRateLimitStore(), [{ key: `demo-live-start:${clientIp(request) ?? "unknown"}`, max: START_LIMIT, windowMs: HOUR_MS }], new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const started = await startLiveDemo({ env: process.env, sessionId: session.id });
    const res = NextResponse.json(started, { status: 201, headers: { "Cache-Control": "no-store" } });
    if (session.setCookie) res.headers.append("Set-Cookie", session.setCookie);
    return res;
  } catch (error) {
    console.error("[demo-live] start failed", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "Unable to start the demo" }, { status: 500 });
  }
}
