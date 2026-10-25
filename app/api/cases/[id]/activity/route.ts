import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { loadActivity } from "@/lib/activity/snapshot";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/activity -> the live-console snapshot as JSON (polling fallback for the SSE stream).
 * `?view=judge` additionally includes provider listen URLs; without it they are stripped.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    if (!(await getServices().cases.get(id))) return jsonError(404, "Case not found");
    const judge = new URL(req.url).searchParams.get("view") === "judge";
    const snapshot = await loadActivity(id, { judge });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, "Unable to load activity", error);
  }
}
