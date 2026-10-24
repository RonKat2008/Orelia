import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { readSession } from '@/lib/auth/session';
import { checkRateLimit, clientIp, getRateLimitStore, PLAN_BUILD_LIMITS, rateLimitedResponse } from '@/lib/rate-limit';
import { gatewayConfig } from '@/lib/ai/gateway';
import { applyPlanEdits, buildContactPlan } from '@/lib/plan';
import { planPatchBodySchema } from '@/lib/plan/contract';
import { loadPlanInputs } from '@/lib/plan/inputs';
import { getPlanStore } from '@/lib/plan/store';
import { emitPlanApproved } from '@/lib/plan/approved-event';
import { materializePlan } from '@/lib/plan/materialize-wiring';
import { validatePlanAgainstInputs } from '@/lib/plan/validate';
import { planEvidenceMeta } from '@/lib/plan/evidence-meta';
import type { ContactPlan, PlanResourceInput } from '@/lib/plan/contract';

/** Evidence display metadata (source host / kind); best effort, never fails the request. */
async function metaFor(caseId: string, plan: ContactPlan, inputs?: readonly PlanResourceInput[]) {
  try {
    return planEvidenceMeta(plan, inputs ?? await loadPlanInputs(caseId));
  } catch {
    return {};
  }
}
import { jsonError, parseBody, parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/plan -> { plan } or 404 when none has been built.
 * `?optional=1` answers 200 { plan: null } instead of 404, for callers (the journey rail) that only peek.
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const plan = await getPlanStore().latest(id);
    if (plan) return NextResponse.json({ plan, evidence: await metaFor(id, plan) });
    return new URL(req.url).searchParams.get('optional') === '1' ? NextResponse.json({ plan: null }) : jsonError(404, 'No contact plan yet');
  } catch (err) {
    return jsonError(500, 'Unable to load the contact plan', err);
  }
}

/** POST /api/cases/[id]/plan { llm? } -> (re)build the plan from the selected resources. Never sends anything. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const llm = await wantsLlm(req);
  try {
    const limit = await checkRateLimit(getRateLimitStore(), PLAN_BUILD_LIMITS(id, readSession(req) ?? 'anonymous', clientIp(req)), new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const inputs = await loadPlanInputs(id);
    if (inputs.length === 0) return jsonError(422, 'Select at least one resource before building a contact plan');
    const store = getPlanStore();
    const existing = await store.latest(id);
    let built = await buildContactPlan(id, inputs, { now: new Date(), llm });
    // A refined plan that fails the evidence check falls back to the deterministic plan; if that fails too, refuse.
    if (llm && validatePlanAgainstInputs(built, inputs).length) built = await buildContactPlan(id, inputs, { now: new Date(), llm: false });
    const problems = validatePlanAgainstInputs(built, inputs);
    if (problems.length) return jsonError(422, 'The contact plan could not be verified against your resources', problems.join('; '));
    const plan = existing ? { ...built, version: existing.version + 1, createdAt: existing.createdAt } : built;
    const saved = await store.save(plan, existing?.version);
    if (!saved) return jsonError(409, 'The contact plan changed; reload and try again');
    return NextResponse.json({ plan: saved, evidence: await metaFor(id, saved, inputs) }, { status: 201 });
  } catch (err) {
    return jsonError(500, 'Unable to build the contact plan', err);
  }
}

/** PATCH /api/cases/[id]/plan { version, edits } -> toggle / reorder / approve with optimistic concurrency. */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, planPatchBodySchema);
  if (!body.ok) return body.response;
  try {
    const store = getPlanStore();
    const current = await store.latest(id);
    if (!current) return jsonError(404, 'No contact plan yet');
    if (body.data.version !== current.version) return jsonError(409, 'The contact plan changed; reload and try again');
    const applied = applyPlanEdits(current, body.data.edits, new Date());
    if (!applied.ok) return jsonError(400, applied.error);
    const inputs = await loadPlanInputs(id);
    const problems = validatePlanAgainstInputs(applied.plan, inputs);
    if (problems.length) return jsonError(422, 'Your selection changed since this plan was built; rebuild the plan', problems.join('; '));
    const saved = await store.save(applied.plan, current.version);
    if (!saved) return jsonError(409, 'The contact plan changed; reload and try again');
    if (current.status !== 'approved' && saved.status === 'approved') {
      await emitPlanApproved(id, saved.version);
      // Writes outbox drafts / application drafts for the steps that are ready now. Nothing is sent.
      return NextResponse.json({ plan: saved, materialized: await materializePlan(saved), evidence: await metaFor(id, saved, inputs) });
    }
    return NextResponse.json({ plan: saved, evidence: await metaFor(id, saved, inputs) });
  } catch (err) {
    return jsonError(500, 'Unable to update the contact plan', err);
  }
}

/** LLM refinement is on when the AI gateway is configured, unless the body says {"llm": false}. */
async function wantsLlm(req: Request): Promise<boolean> {
  let optOut = false;
  try {
    const raw: unknown = await req.json();
    optOut = typeof raw === 'object' && raw !== null && (raw as { llm?: unknown }).llm === false;
  } catch {
    optOut = false; // empty/non-JSON body is fine
  }
  return !optOut && gatewayConfig() !== undefined;
}

