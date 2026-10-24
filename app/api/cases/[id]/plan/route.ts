import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { gatewayConfig } from '@/lib/ai/gateway';
import { applyPlanEdits, buildContactPlan } from '@/lib/plan';
import { planPatchBodySchema } from '@/lib/plan/contract';
import { loadPlanInputs } from '@/lib/plan/inputs';
import { getPlanStore } from '@/lib/plan/store';
import { emitPlanApproved } from '@/lib/plan/approved-event';
import { materializePlan } from '@/lib/plan/materialize-wiring';
import { validatePlanAgainstInputs } from '@/lib/plan/validate';
import { jsonError, parseBody, parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/plan -> { plan } or 404 when none has been built. */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const plan = await getPlanStore().latest(id);
    return plan ? NextResponse.json({ plan }) : jsonError(404, 'No contact plan yet');
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
    return NextResponse.json({ plan: saved }, { status: 201 });
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
    const problems = validatePlanAgainstInputs(applied.plan, await loadPlanInputs(id));
    if (problems.length) return jsonError(422, 'Your selection changed since this plan was built; rebuild the plan', problems.join('; '));
    const saved = await store.save(applied.plan, current.version);
    if (!saved) return jsonError(409, 'The contact plan changed; reload and try again');
    if (current.status !== 'approved' && saved.status === 'approved') {
      await emitPlanApproved(id, saved.version);
      // Writes outbox drafts / application drafts for the steps that are ready now. Nothing is sent.
      return NextResponse.json({ plan: saved, materialized: await materializePlan(saved) });
    }
    return NextResponse.json({ plan: saved });
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

