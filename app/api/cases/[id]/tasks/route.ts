import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { getCaseActivity, tasksResponseSchema } from "@/lib/cases/activity";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/tasks — open and approved tasks scoped to the case. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const found = await getServices().cases.get(id);
    if (!found) return jsonError(404, "Case not found");
    const body = tasksResponseSchema.parse({ caseId: id, tasks: await getCaseActivity().tasks(id) });
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(500, "Unable to load tasks", error);
  }
}
