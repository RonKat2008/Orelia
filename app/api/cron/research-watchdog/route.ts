import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/app/api/cases/_lib/services";
import { sweepStuckResearch } from "@/lib/workflows/research-watchdog";
import { listResearchingCaseIds } from "@/lib/workflows/researching-cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep in sync with vercel.ts.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || !secret.trim()) return false; // fail closed when CRON_SECRET is unset
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GET /api/cron/research-watchdog -> Vercel Cron. Ends research that went quiet (function killed) so the patient can retry. */
export async function GET(request: Request) {
  if (!authorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "database_not_configured" }, { status: 503, headers: NO_STORE });
  }
  try {
    const { cases, runs } = getServices();
    const result = await sweepStuckResearch({ cases, runs, listResearching: listResearchingCaseIds });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    console.error("[cron/research-watchdog] sweep failed", error instanceof Error ? error.name : "error");
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500, headers: NO_STORE });
  }
}
