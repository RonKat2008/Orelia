import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { liveCallsFor } from "@/lib/outreach/call-live-read";
import { getServices } from "../../../_lib/services";
import { jsonError, parseId } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/calls/live[?view=judge] -> { calls }: each call's live status and transcript turns so far
 * (Vapi webhooks store them as they arrive). Only ?view=judge adds the listen-only monitor URL.
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    if (!(await getServices().cases.get(id))) return jsonError(404, "Case not found");
    const judge = new URL(req.url).searchParams.get("view") === "judge";
    return NextResponse.json({ calls: await liveCallsFor(id, judge) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(500, "Unable to load calls", err);
  }
}
