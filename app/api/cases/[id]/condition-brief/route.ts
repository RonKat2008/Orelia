import { NextResponse } from "next/server";
import { z } from "zod";
import { guardCase } from "@/lib/auth/ownership";
import { readSession } from "@/lib/auth/session";
import { checkRateLimit, getRateLimitStore, rateLimitedResponse, type RateRule } from "@/lib/rate-limit";
import { buildConditionBrief, ConditionBriefUnavailableError } from "@/lib/condition-brief/build";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import { getConditionBriefStore } from "@/lib/condition-brief/store";
import { jsonError, parseBody, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const HOUR_MS = 60 * 60 * 1000;
/** Each rebuild fans out to several public APIs and one model call. */
const BRIEF_LIMITS = (caseId: string, sessionId: string): RateRule[] => [
  { key: `condition-brief:case:${caseId}`, max: 6, windowMs: HOUR_MS },
  { key: `condition-brief:session:${sessionId}`, max: 20, windowMs: HOUR_MS },
];

const postBodySchema = z.object({ refresh: z.boolean().optional() }).strict();

/** One rebuild per case at a time (per server instance); concurrent POSTs share the same promise. */
const g = globalThis as unknown as { __wayfinderConditionBriefInflight?: Map<string, Promise<ConditionBrief>> };
const inflight = (g.__wayfinderConditionBriefInflight ??= new Map());

/** GET /api/cases/[id]/condition-brief -> { brief } or 404 when none has been built. */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const brief = await getConditionBriefStore().latest(id);
    return brief ? NextResponse.json({ brief }) : jsonError(404, "No condition brief yet");
  } catch (err) {
    return jsonError(500, "Unable to load the condition brief", err);
  }
}

/** POST /api/cases/[id]/condition-brief { refresh? } -> cached brief (200) unless refresh or none, else build (201). */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, postBodySchema);
  if (!body.ok) return body.response;
  try {
    const store = getConditionBriefStore();
    if (!body.data.refresh) {
      const cached = await store.latest(id);
      if (cached) return NextResponse.json({ brief: cached });
    }
    const limit = await checkRateLimit(getRateLimitStore(), BRIEF_LIMITS(id, readSession(req) ?? "anonymous"), new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const found = await getServices().cases.get(id);
    if (!found) return jsonError(404, "Case not found");
    const brief = await rebuild(id, found.diseaseName);
    return NextResponse.json({ brief }, { status: 201 });
  } catch (err) {
    if (err instanceof ConditionBriefUnavailableError) return jsonError(422, err.message);
    return jsonError(500, "Unable to build the condition brief", err);
  }
}

function rebuild(caseId: string, diseaseName: string): Promise<ConditionBrief> {
  const running = inflight.get(caseId);
  if (running) return running;
  const store = getConditionBriefStore();
  const job = buildConditionBrief(caseId, diseaseName, { store })
    .then(brief => store.save(brief))
    .finally(() => inflight.delete(caseId));
  inflight.set(caseId, job);
  return job;
}
