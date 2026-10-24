import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCase } from "@/lib/agents/intake-extractor";
import { OutOfScopeError } from "@/lib/agents/report-scope";
import { REPORT_TEXT_MAX, REPORT_TEXT_MIN } from "@/lib/contracts";
import { rejectCrossOrigin } from "@/lib/auth/origin";
import { getOwnerStore } from "@/lib/auth/ownership";
import { ensureSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp, CREATE_CASE_IP_LIMITS, getRateLimitStore, rateLimitedResponse } from "@/lib/rate-limit";
import { jsonError, parseBody } from "./_lib/http";
import { ingestSummarySafely } from "./_lib/case-summary";
import { getServices } from "./_lib/services";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Answer before the 120s function limit kills the request with a non-JSON platform error. */
const EXTRACT_DEADLINE_MS = 105_000;
class ExtractTimeoutError extends Error {}
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ExtractTimeoutError("extraction timed out")), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const bodySchema = z.object({ reportText: z.string().trim().min(REPORT_TEXT_MIN).max(REPORT_TEXT_MAX) });

/** POST /api/cases { reportText } -> extract with Opus, insert case as 'draft' for the patient to confirm. */
export async function POST(req: Request) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const session = ensureSession(req);
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  // Each case is a model extraction and opens fresh per-case research budgets: cap creations per client.
  const limit = await checkRateLimit(getRateLimitStore(), CREATE_CASE_IP_LIMITS(clientIp(req)), new Date());
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
  let input: Awaited<ReturnType<typeof extractCase>>;
  try {
    input = await withDeadline(extractCase(body.data.reportText), EXTRACT_DEADLINE_MS);
  } catch (e) {
    if (e instanceof OutOfScopeError) return jsonError(422, e.message);
    if (e instanceof ExtractTimeoutError) return jsonError(504, "Reading the report took too long; please try again", e.message);
    return jsonError(502, "Could not extract case fields from the report", e instanceof Error ? e.message : String(e));
  }
  try {
    const created = await getServices().cases.create(input, "draft");
    await getOwnerStore().setOwner(created.id, session.id);
    await ingestSummarySafely(created);
    const res = NextResponse.json({ case: created }, { status: 201 });
    if (session.setCookie) res.headers.append("Set-Cookie", session.setCookie);
    return res;
  } catch (e) {
    return jsonError(502, "Could not save the case", e instanceof Error ? e.message : String(e));
  }
}
