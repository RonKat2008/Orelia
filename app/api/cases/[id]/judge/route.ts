import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { getNeedsStore } from "@/lib/agents/needs/store";
import { jsonError, parseId } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/judge -> { needs, judge }: the case's CareNeeds profile (sourced needs, plain versions) and
 * the final judge's validated verdicts. Either is null until the research run has produced it.
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const store = getNeedsStore();
    const [needs, judge] = await Promise.all([store.loadNeeds(id), store.loadJudge(id)]);
    return NextResponse.json({ needs, judge }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(500, "Unable to load the needs profile and judge verdicts", err);
  }
}
