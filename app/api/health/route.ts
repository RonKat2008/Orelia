import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { healthReport } from "./_lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health -> deployment readiness. 200 when ok, 503 otherwise. No secrets, no error text. */
export async function GET() {
  const report = await healthReport({
    source: process.env,
    pingDb: async () => {
      await getDb().execute(sql`SELECT 1`);
    },
  });
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
