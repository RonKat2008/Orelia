import { NextResponse } from "next/server";
import { z } from "zod";
import { caseInputSchema } from "@/lib/contracts";
import { guardCase } from "@/lib/auth/ownership";
import { fieldPaths, jsonError, parseBody, parseId } from "../_lib/http";
import { getServices } from "../_lib/services";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Edits are partial; the merged result must still satisfy the full CaseInput contract.
const patchSchema = z.object({ fields: caseInputSchema.partial().default({}) });

export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const found = await getServices().cases.get(id);
  return found ? NextResponse.json({ case: found }) : jsonError(404, "Case not found");
}

/** PATCH /api/cases/[id] { fields? } -> apply the patient's edits and confirm (status 'confirmed'). */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const { cases } = getServices();
  const existing = await cases.get(id);
  if (!existing) return jsonError(404, "Case not found");
  if (existing.status === "researching") return jsonError(409, "Research is running; case cannot be edited");

  const current = omit(existing, ["id", "status", "createdAt"]);
  const merged = caseInputSchema.safeParse({ ...current, ...stripUndefined(body.data.fields) });
  if (!merged.success) return jsonError(400, "Edited case is invalid", z.treeifyError(merged.error), fieldPaths(merged.error));

  const updated = await cases.update(id, merged.data, "confirmed");
  return updated ? NextResponse.json({ case: updated }) : jsonError(404, "Case not found");
}

function omit<T extends object, K extends keyof T>(o: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k as K))) as Omit<T, K>;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
