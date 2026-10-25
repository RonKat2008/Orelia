import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";
import { defaultDeps, loadConditionCard } from "./load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/condition-card -> { card, symptoms, travel }: the "Your condition" facts (each with its source
 * link), the extractive symptom summary for undiagnosed cases, and travel and money help from the shortlist.
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const { cases, persist } = getServices();
    const found = await cases.get(id);
    if (!found) return jsonError(404, "Case not found");
    const body = await loadConditionCard(found, defaultDeps(persist));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(500, "Unable to load the condition card", err);
  }
}
