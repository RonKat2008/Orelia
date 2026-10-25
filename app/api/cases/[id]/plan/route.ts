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
import { spawnForApprovedPlan } from '@/lib/agents/factory';
import { materializePlan } from '@/lib/plan/materialize-wiring';
import { validatePlanAgainstInputs } from '@/lib/plan/validate';
import { planEvidenceMeta } from '@/lib/plan/evidence-meta';
import type { ContactPlan, PlanResourceInput, PlanStep } from '@/lib/plan/contract';

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
  const opts = await readPostOptions(req);
  const llm = opts.llm && gatewayConfig() !== undefined;
  try {
    const limit = await checkRateLimit(getRateLimitStore(), PLAN_BUILD_LIMITS(id, readSession(req) ?? 'anonymous', clientIp(req)), new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const inputs = await loadPlanInputs(id);
    if (inputs.length === 0) return jsonError(422, 'Select at least one resource before building a contact plan');
    const store = getPlanStore();
    const existing = await store.latest(id);
    // An approved plan has live drafts and a running workflow; rebuilding would silently revoke it.
    if (existing?.status === 'approved' && !opts.rebuild) return jsonError(409, 'This plan is already approved. Rebuild only if you want to replace it');
    let built = await buildContactPlan(id, inputs, { now: new Date(), llm });
    // A refined plan that fails the evidence check falls back to the deterministic plan; if that fails too, refuse.
    if (llm && validatePlanAgainstInputs(built, inputs).length) built = await buildContactPlan(id, inputs, { now: new Date(), llm: false });
    const problems = validatePlanAgainstInputs(built, inputs);
    if (problems.length) return jsonError(422, 'The contact plan could not be verified against your resources', problems.join('; '));
    const carried = existing ? carryOverToggles(built, existing) : built;
    const plan = existing ? { ...carried, version: existing.version + 1, createdAt: existing.createdAt } : carried;
    // Version 0 means "no plan yet": a concurrent first build loses with 409 instead of silently replacing the winner.
    const saved = await store.save(plan, existing?.version ?? 0);
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
      const materialized = await materializePlan(saved);
      // Agent factory: one persistent ResourceAgent per planned resource (idempotent; never sends). Never fails the approval.
      const agents = await spawnForApprovedPlan(saved);
      return NextResponse.json({ plan: saved, materialized, ...(agents ? { agents } : {}), evidence: await metaFor(id, saved, inputs) });
    }
    return NextResponse.json({ plan: saved, evidence: await metaFor(id, saved, inputs) });
  } catch (err) {
    return jsonError(500, 'Unable to update the contact plan', err);
  }
}

/** POST body: {"llm": false} opts out of LLM refinement; {"rebuild": true} allows replacing an approved plan. */
async function readPostOptions(req: Request): Promise<{ llm: boolean; rebuild: boolean }> {
  try {
    const raw = await req.json() as { llm?: unknown; rebuild?: unknown } | null;
    return { llm: raw?.llm !== false, rebuild: raw?.rebuild === true };
  } catch {
    return { llm: true, rebuild: false }; // empty/non-JSON body is fine
  }
}

const stepKey = (resourceKey: string, s: PlanStep) => `${resourceKey}|${s.channel}|${s.targetRef}`;

/** A rebuilt plan keeps the patient's switched-off steps (same resource + channel + target) switched off. */
function carryOverToggles(built: ContactPlan, existing: ContactPlan): ContactPlan {
  const off = new Set(existing.resources.flatMap(r => r.steps.filter(s => !s.enabled).map(s => stepKey(r.resourceKey, s))));
  if (off.size === 0) return built;
  return {
    ...built,
    resources: built.resources.map(r => ({ ...r, steps: r.steps.map(s => (off.has(stepKey(r.resourceKey, s)) ? { ...s, enabled: false } : s)) })),
  };
}
