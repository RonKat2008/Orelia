import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { getCaseActivity, threadsResponseSchema } from "@/lib/cases/activity";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/threads — messages and call transcripts grouped by contact. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const [found, threads] = await Promise.all([getServices().cases.get(id), getCaseActivity().threads(id)]);
    if (!found) return jsonError(404, "Case not found");
    const body = threadsResponseSchema.parse({ caseId: id, threads });
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(500, "Unable to load threads", error);
  }
}
