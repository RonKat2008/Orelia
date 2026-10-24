import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { loadProgress, isFinished } from "@/lib/agents/progress-snapshot";
import { reapIfStuck } from "@/lib/workflows/research-watchdog";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/status -> the same snapshot the SSE 'runs' event carries, as plain JSON. The browser polls this
 * when the stream drops or goes quiet. Also runs the lazy stuck-research check, so polling alone can never hang.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const { cases, runs } = getServices();
    await reapIfStuck(id, { cases, runs }).catch(() => undefined);
    const progress = await loadProgress(id, { cases, runs });
    if (!progress.caseStatus) return jsonError(404, "Case not found");
    return NextResponse.json({ ...progress, finished: isFinished(progress) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, "Unable to process request", error);
  }
}
