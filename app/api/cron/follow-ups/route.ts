import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runCronTick } from "@/lib/workflows/cron-tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep in sync with vercel.ts.
export const maxDuration = 120;

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || !secret.trim()) return false; // fail closed when CRON_SECRET is unset
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * GET /api/cron/follow-ups -> Vercel Cron, every minute (vercel.ts). Runs the cron tick (lib/workflows/cron-tick.ts):
 * the follow-up sweep (same logic as the Inngest workflow: pre-approved send or unapproved draft, stall after day
 * 10), the demo coordinator's scripted replies (demo mode only) and any due resource agents. Every step leases its
 * work atomically, so overlapping ticks never act twice. Inngest, when connected, owns the follow-up timers and the
 * sweep step skips itself.
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
 */
export async function GET(request: Request) {
  if (!authorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "database_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await runCronTick();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/follow-ups] tick failed", error instanceof Error ? error.name : "error");
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
