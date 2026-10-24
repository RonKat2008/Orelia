import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { reviews } from "@/db/schema";
import { agreementByKind, isTargetKind, type ReviewVerdict } from "@/components/ranking/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isVerdict(value: unknown): value is ReviewVerdict {
  return value === "correct" || value === "incorrect";
}

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId");
  if (!caseId || !UUID.test(caseId)) {
    return Response.json({ error: "caseId must be a UUID" }, { status: 400 });
  }
  try {
    const db = getDb();
    const rows = await db.select().from(reviews).where(eq(reviews.caseId, caseId));
    return Response.json({
      caseId,
      agreement: agreementByKind(rows.map((row) => ({ targetKind: row.targetKind, verdict: row.verdict }))),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read reviews";
    const status = message.includes("DATABASE_URL") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}

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
  const input = body as {
    caseId?: unknown;
    reviewer?: unknown;
    targetKind?: unknown;
    targetId?: unknown;
    verdict?: unknown;
    note?: unknown;
  };
  if (typeof input.caseId !== "string" || !UUID.test(input.caseId)) {
    return Response.json({ error: "caseId must be a UUID" }, { status: 400 });
  }
  if (typeof input.targetId !== "string" || !UUID.test(input.targetId)) {
    return Response.json({ error: "targetId must be a UUID" }, { status: 400 });
  }
  if (typeof input.targetKind !== "string" || !isTargetKind(input.targetKind)) {
    return Response.json({ error: "targetKind must be expert, institution, trial, or organization" }, { status: 400 });
  }
  if (!isVerdict(input.verdict)) {
    return Response.json({ error: "verdict must be correct or incorrect" }, { status: 400 });
  }
  if (typeof input.reviewer !== "string" || input.reviewer.trim().length === 0 || input.reviewer.trim().length > 200) {
    return Response.json({ error: "reviewer is required" }, { status: 400 });
  }
  let note: string | null = null;
  if (input.note != null) {
    if (typeof input.note !== "string" || input.note.length > 2000) {
      return Response.json({ error: "note must be a string of at most 2000 characters" }, { status: 400 });
    }
    note = input.note.trim() || null;
  }

  try {
    const db = getDb();
    const [created] = await db
      .insert(reviews)
      .values({
        caseId: input.caseId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        reviewer: input.reviewer.trim(),
        verdict: input.verdict,
        note,
      })
      .returning();
    const rows = await db.select().from(reviews).where(eq(reviews.caseId, input.caseId));
    return Response.json(
      {
        review: created,
        agreement: agreementByKind(rows.map((row) => ({ targetKind: row.targetKind, verdict: row.verdict }))),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the review";
    const status = message.includes("DATABASE_URL") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
