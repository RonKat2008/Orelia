import { contactPlanSchema, type ContactPlan, type PlanEdit } from '@/lib/plan/contract';
import type { PlanEvidenceMeta } from '@/lib/plan/evidence-meta';

function evidenceOf(raw: unknown): PlanEvidenceMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: PlanEvidenceMeta = {};
  for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
    const v = m as { host?: unknown; sourceKind?: unknown; label?: unknown } | null;
    if (v && typeof v.label === 'string' && typeof v.sourceKind === 'string') out[id] = { label: v.label, sourceKind: v.sourceKind, host: typeof v.host === 'string' ? v.host : null };
  }
  return out;
}

export type PlanResult = { ok: true; plan: ContactPlan; /** PATCH approve only: raw `materialized` from the response. */ materialized?: unknown; /** Source host/kind per cited evidence id. */ evidence?: PlanEvidenceMeta } | { ok: false; status: number; message: string };

type Fetch = typeof fetch;

const url = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/plan`;

async function read(res: Response): Promise<PlanResult> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && (body as { plan?: unknown } | null)?.plan === null) return { ok: false, status: 404, message: 'No contact plan yet' };
  if (res.ok) {
    const parsed = contactPlanSchema.safeParse((body as { plan?: unknown } | null)?.plan);
    if (parsed.success) return { ok: true, plan: parsed.data, materialized: (body as { materialized?: unknown } | null)?.materialized, evidence: evidenceOf((body as { evidence?: unknown } | null)?.evidence) };
    return { ok: false, status: 502, message: 'The plan came back in an unexpected shape.' };
  }
  const error = (body as { error?: unknown } | null)?.error;
  const message = typeof error === 'string' ? error : typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : 'Something went wrong. Nothing was sent.';
  return { ok: false, status: res.status, message };
}

async function call(f: Fetch, target: string, init?: RequestInit): Promise<PlanResult> {
  try {
    return await read(await f(target, init));
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Nothing was sent.' };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Peeks with ?optional=1 (200 { plan: null } instead of a logged 404); "none yet" still reads as status 404. */
export const getPlan = (caseId: string, f: Fetch = fetch) => call(f, `${url(caseId)}?optional=1`);
export const buildPlan = (caseId: string, f: Fetch = fetch) => call(f, url(caseId), json('POST', {}));
export const patchPlan = (caseId: string, version: number, edits: PlanEdit[], f: Fetch = fetch) =>
  call(f, url(caseId), json('PATCH', { version, edits }));

/** GET the plan; when none exists yet (404) build it. */
export async function getOrBuildPlan(caseId: string, f: Fetch = fetch): Promise<PlanResult> {
  const got = await getPlan(caseId, f);
  return !got.ok && got.status === 404 ? buildPlan(caseId, f) : got;
}
