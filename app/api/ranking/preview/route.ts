import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { caseCandidates } from "@/db/schema";
import { parseWeights, previewRank, type StoredBreakdownItem, type StoredCandidate } from "@/components/ranking/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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
    const message = error instanceof Error ? error.message : "Ranking preview failed";
    const status = message.includes("DATABASE_URL") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
