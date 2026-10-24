import { NextResponse } from "next/server";
import { z } from "zod";
import { caseInputSchema } from "@/lib/contracts";
import { jsonError, parseBody, parseId } from "../_lib/http";
import { getServices } from "../_lib/services";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Edits are partial; the merged result must still satisfy the full CaseInput contract.
const patchSchema = z.object({ fields: caseInputSchema.partial().default({}) });

export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const found = await getServices().cases.get(id);
  return found ? NextResponse.json({ case: found }) : jsonError(404, "Case not found");
}

/** PATCH /api/cases/[id] { fields? } -> apply the patient's edits and confirm (status 'confirmed'). */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const { cases } = getServices();
  const existing = await cases.get(id);
  if (!existing) return jsonError(404, "Case not found");
  if (existing.status === "researching") return jsonError(409, "Research is running; case cannot be edited");

  const { id: _id, status: _s, createdAt: _c, ...current } = existing;
  const merged = caseInputSchema.safeParse({ ...current, ...stripUndefined(body.data.fields) });
  if (!merged.success) return jsonError(400, "Edited case is invalid", z.treeifyError(merged.error));

  const updated = await cases.update(id, merged.data, "confirmed");
  return updated ? NextResponse.json({ case: updated }) : jsonError(404, "Case not found");
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
