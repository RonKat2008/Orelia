import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCase } from "@/lib/agents/intake-extractor";
import { rejectCrossOrigin } from "@/lib/auth/origin";
import { getOwnerStore } from "@/lib/auth/ownership";
import { ensureSession } from "@/lib/auth/session";
import { jsonError, parseBody } from "./_lib/http";
import { ingestSummarySafely } from "./_lib/case-summary";
import { getServices } from "./_lib/services";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ reportText: z.string().trim().min(20).max(60_000) });

/** POST /api/cases { reportText } -> extract with Opus, insert case as 'draft' for the patient to confirm. */
export async function POST(req: Request) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const session = ensureSession(req);
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const input = await extractCase(body.data.reportText);
    const created = await getServices().cases.create(input, "draft");
    await getOwnerStore().setOwner(created.id, session.id);
    await ingestSummarySafely(created);
    const res = NextResponse.json({ case: created }, { status: 201 });
    if (session.setCookie) res.headers.append("Set-Cookie", session.setCookie);
    return res;
  } catch (e) {
    return jsonError(502, "Could not extract case fields from the report", e instanceof Error ? e.message : String(e));
  }
}
