import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { jsonError, parseId } from "../../_lib/http";
import { buildPatientStatusBody, loadPatientSnapshot, timeZoneFrom } from "../../_lib/patient-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/patient-status -> the patient view's status line, "what's happened" list and waiting draft. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const snapshot = await loadPatientSnapshot(id);
    if (!snapshot.found) return jsonError(404, "Case not found");
    const body = buildPatientStatusBody(snapshot, new Date(), timeZoneFrom(req));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, "Unable to load the case status", error);
  }
}
