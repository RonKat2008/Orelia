import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCase } from "@/lib/agents/intake-extractor";
import { jsonError, parseBody } from "./_lib/http";
import { getServices } from "./_lib/services";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ reportText: z.string().trim().min(20).max(60_000) });

/** POST /api/cases { reportText } -> extract with Opus, insert case as 'draft' for the patient to confirm. */
export async function POST(req: Request) {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const input = await extractCase(body.data.reportText);
    const created = await getServices().cases.create(input, "draft");
    return NextResponse.json({ case: created }, { status: 201 });
  } catch (e) {
    return jsonError(502, "Could not extract case fields from the report", e instanceof Error ? e.message : String(e));
  }
}
