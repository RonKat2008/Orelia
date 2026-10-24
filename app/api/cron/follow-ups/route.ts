import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createDefaultDeps } from "@/lib/workflows/default-deps";
import { PostgresFollowUpSweepStore, runFollowUpSweep } from "@/lib/workflows/follow-up-sweep";
import { schedulingConnected } from "@/lib/workflows/scheduler";

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
 * GET /api/cron/follow-ups -> Vercel Cron (hourly). Sweeps contacts whose next follow-up is due and runs the
 * same follow-up logic as the Inngest workflow (pre-approved send or unapproved draft, stall after day 7+).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
 */
export async function GET(request: Request) {
  if (!authorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (schedulingConnected()) {
    // Inngest owns the timers; sweeping too could double-handle a contact.
    return NextResponse.json({ ok: true, skipped: "inngest_active" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "database_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await runFollowUpSweep({ store: new PostgresFollowUpSweepStore(), deps: createDefaultDeps() });
    return NextResponse.json({ ok: result.failed === 0, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/follow-ups] sweep failed", error instanceof Error ? error.name : "error");
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
