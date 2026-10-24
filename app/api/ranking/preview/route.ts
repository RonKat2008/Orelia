import { guardCase } from "@/lib/auth/ownership";
import { rejectCrossOrigin } from "@/lib/auth/origin";
import { jsonError } from "@/app/api/cases/_lib/http";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { caseCandidates } from "@/db/schema";
import { parseWeights, previewRank, type StoredBreakdownItem, type StoredCandidate } from "@/components/ranking/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected an object" }, { status: 400 });
  }
  const { caseId, weights } = body as { caseId?: unknown; weights?: unknown };
  if (typeof caseId !== "string" || !UUID.test(caseId)) {
    return Response.json({ error: "caseId must be a UUID" }, { status: 400 });
  }
  const parsed = parseWeights(weights);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const denied = await guardCase(request, caseId);
    if (denied) return denied;
    const db = getDb();
    const rows = await db.select().from(caseCandidates).where(eq(caseCandidates.caseId, caseId));
    const stored: StoredCandidate[] = rows.map((row) => ({
      id: row.id,
      targetKind: row.targetKind,
      targetId: row.targetId,
      scoreBreakdown: (row.scoreBreakdown ?? null) as StoredBreakdownItem[] | null,
    }));
    const candidates = previewRank(stored, parsed.weights);
    return Response.json({ caseId, weights: parsed.weights, persisted: false, candidates });
  } catch (error) {
    return jsonError(500, "Unable to process request", error);
  }
}
