import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardCase } from '@/lib/auth/ownership';
import { loadPlanInputs } from '@/lib/plan/inputs';
import { getCoordinationStore } from '@/lib/coordination/store';
import { getRequirementsDeps } from '@/lib/coordination/requirements/deps';
import { buildChecklists, ChecklistConflictError, requirementPatchSchema, resourceKeyOf, updateRequirement } from '@/lib/coordination/requirements/service';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const postBodySchema = z.object({ resourceKey: z.string().min(1).max(100).optional() }).strict();

/** GET -> { checklists } for the case (empty until built). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ checklists: await getCoordinationStore().list(id, 'checklist') });
  } catch (err) {
    return jsonError(500, 'Unable to load the referral checklists', err);
  }
}

/** POST { resourceKey? } -> (re)build the checklist of one / every selected resource. Reads public pages only; sends nothing. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseOptionalBody(req);
  if (!body.ok) return body.response;
  try {
    const inputs = await loadPlanInputs(id);
    if (inputs.length === 0) return jsonError(422, 'Select at least one resource before checking referral requirements');
    const key = body.data.resourceKey;
    if (key && !inputs.some(r => resourceKeyOf(r) === key)) return jsonError(404, 'That resource is not selected');
    const checklists = await buildChecklists(id, inputs, getRequirementsDeps(), getCoordinationStore(), key);
    return NextResponse.json({ checklists }, { status: 201 });
  } catch (err) {
    if (err instanceof ChecklistConflictError) return jsonError(409, 'The checklist changed; reload and try again');
    return jsonError(500, 'Unable to check referral requirements', err);
  }
}

/** PATCH { resourceKey, version, requirementId, status, note? } -> { checklist } (409 on version conflict). */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, requirementPatchSchema);
  if (!body.ok) return body.response;
  try {
    const result = await updateRequirement(id, body.data, getRequirementsDeps(), getCoordinationStore());
    if (result.kind === 'not_found') return jsonError(404, 'Requirement not found');
    if (result.kind === 'conflict') return jsonError(409, 'The checklist changed; reload and try again');
    return NextResponse.json({ checklist: result.checklist });
  } catch (err) {
    return jsonError(500, 'Unable to update the requirement', err);
  }
}

/** An empty body means "all selected resources"; a present body must match the schema. */
async function parseOptionalBody(req: Request): Promise<{ ok: true; data: z.infer<typeof postBodySchema> } | { ok: false; response: NextResponse }> {
  const text = await req.text();
  if (!text.trim()) return { ok: true, data: {} };
  return parseBody(new Request(req.url, { method: 'POST', body: text, headers: { 'content-type': 'application/json' } }), postBodySchema);
}
