import { NextResponse } from "next/server";
import { z } from "zod";
import { caseInputSchema } from "@/lib/contracts";
import { guardCase } from "@/lib/auth/ownership";
import { readSession } from "@/lib/auth/session";
import { checkRateLimit, DELETE_CASE_LIMITS, getRateLimitStore, rateLimitedResponse } from "@/lib/rate-limit";
import { fieldPaths, jsonError, parseBody, parseId } from "../_lib/http";
import { ingestSummarySafely } from "../_lib/case-summary";
import { getServices } from "../_lib/services";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Edits are partial; the merged result must still satisfy the full CaseInput contract.
const patchSchema = z.strictObject({ fields: caseInputSchema.partial().default({}) });

export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const found = await getServices().cases.get(id);
    return found ? NextResponse.json({ case: found }) : jsonError(404, "Case not found");
  } catch (error) {
    return jsonError(500, "Unable to process request", error);
  }
}

/** PATCH /api/cases/[id] { fields? } -> apply the patient's edits and confirm (status 'confirmed'). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
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
    if (!updated) return jsonError(404, "Case not found");
    await ingestSummarySafely(updated);
    return NextResponse.json({ case: updated });
  } catch (error) {
    return jsonError(500, "Unable to process request", error);
  }
}

/**
 * DELETE /api/cases/[id] — owner-only. Same-origin + owner session (guardCase), rate limited, then removes the case and
 * every dependent row (contacts, messages, tasks, documents, ... via ON DELETE CASCADE). Afterwards the id is a 404.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const limit = await checkRateLimit(getRateLimitStore(), DELETE_CASE_LIMITS(readSession(req) ?? "anonymous"), new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const deleted = await getServices().cases.delete(id);
    return deleted ? NextResponse.json({ deleted: true }) : jsonError(404, "Case not found");
  } catch (error) {
    return jsonError(500, "Unable to delete case", error);
  }
}

function omit<T extends object, K extends keyof T>(o: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k as K))) as Omit<T, K>;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
