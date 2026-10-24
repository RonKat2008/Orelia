import { z } from 'zod';
import type { PlanResourceInput } from '@/lib/plan/contract';
import { requirementStatusSchema, type ReferralRequirement, type RequirementsChecklist } from '../contract';
import type { CoordinationStore } from '../contract';
import type { RequirementsDeps } from './deps';
import { gatherRequirements } from './finder';
import { matchRequirement } from './match';

const MAX_REQUIREMENTS = 30;
const MAX_CHECKED = 20;
const NONE_FOUND = 'No referral requirements were found on the pages checked. Call or email the center to ask what they need.';

export const resourceKeyOf = (r: { targetKind: string; targetId: string }) => `${r.targetKind}:${r.targetId}`;
const identity = (r: { kind: string; sourceUrl: string; label: string }) => `${r.kind}|${r.sourceUrl}|${r.label}`;

export const requirementPatchSchema = z.object({
  resourceKey: z.string().min(1).max(100),
  version: z.number().int().min(1),
  requirementId: z.string().min(1).max(40),
  status: requirementStatusSchema,
  note: z.string().trim().max(400).nullable().optional(),
}).strict();
export type RequirementPatch = z.infer<typeof requirementPatchSchema>;

async function build(caseId: string, r: PlanResourceInput, deps: RequirementsDeps, store: CoordinationStore): Promise<RequirementsChecklist> {
  const key = resourceKeyOf(r);
  const [existing, gathered, docs] = await Promise.all([store.get(caseId, 'checklist', key), gatherRequirements(r, deps), deps.listDocs(caseId).catch(() => [])]);
  const nowIso = deps.now().toISOString();
  const prior = new Map((existing?.requirements ?? []).map(q => [identity(q), q]));
  const seen = new Set<string>();
  const requirements: ReferralRequirement[] = [];
  for (const c of gathered.candidates) {
    const id = identity(c);
    if (seen.has(id) || requirements.length >= MAX_REQUIREMENTS) continue;
    seen.add(id);
    const before = prior.get(id);
    const matched = matchRequirement(c, docs);
    // The patient's own choice (patient_to_request) and notes survive a refresh.
    const keepPatient = before?.status === 'patient_to_request';
    requirements.push({
      id: `r${requirements.length + 1}`, kind: c.kind, label: c.label, detail: c.detail, sourceUrl: c.sourceUrl, origin: c.origin,
      status: keepPatient ? 'patient_to_request' : matched.status,
      matchedDocId: keepPatient ? null : matched.matchedDocId,
      note: before?.note ?? null,
      updatedAt: before && keepPatient ? before.updatedAt : nowIso,
    });
  }
  const checklist: RequirementsChecklist = {
    caseId, resourceKey: key as RequirementsChecklist['resourceKey'], name: r.name.slice(0, 200) || key,
    requirements, checkedUrls: gathered.checkedUrls.slice(0, MAX_CHECKED),
    unavailableReason: requirements.length ? null : NONE_FOUND,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso,
  };
  const saved = await store.save(caseId, 'checklist', key, checklist, existing?.version);
  if (!saved) throw new ChecklistConflictError();
  return saved;
}

export class ChecklistConflictError extends Error { constructor() { super('checklist changed concurrently'); this.name = 'ChecklistConflictError'; } }

/** Builds (or refreshes) the checklist of each selected resource, or only `onlyKey`. Never contacts anyone. */
export async function buildChecklists(caseId: string, resources: readonly PlanResourceInput[], deps: RequirementsDeps, store: CoordinationStore, onlyKey?: string): Promise<RequirementsChecklist[]> {
  const targets = onlyKey ? resources.filter(r => resourceKeyOf(r) === onlyKey) : [...resources];
  const out: RequirementsChecklist[] = [];
  for (const r of targets) out.push(await build(caseId, r, deps, store));
  return out;
}

export type UpdateResult =
  | { kind: 'ok'; checklist: RequirementsChecklist }
  | { kind: 'conflict' }
  | { kind: 'not_found' };

/** Patient sets a requirement's status / note, with optimistic concurrency on the checklist version. */
export async function updateRequirement(caseId: string, patch: RequirementPatch, deps: Pick<RequirementsDeps, 'now'>, store: CoordinationStore): Promise<UpdateResult> {
  const current = await store.get(caseId, 'checklist', patch.resourceKey);
  if (!current || !current.requirements.some(q => q.id === patch.requirementId)) return { kind: 'not_found' };
  if (current.version !== patch.version) return { kind: 'conflict' };
  const nowIso = deps.now().toISOString();
  const next: RequirementsChecklist = {
    ...current,
    requirements: current.requirements.map(q => q.id !== patch.requirementId ? q : {
      ...q, status: patch.status, matchedDocId: patch.status === 'have' ? q.matchedDocId : null,
      note: patch.note === undefined ? q.note : (patch.note || null), updatedAt: nowIso,
    }),
    version: current.version + 1, updatedAt: nowIso,
  };
  const saved = await store.save(caseId, 'checklist', patch.resourceKey, next, current.version);
  return saved ? { kind: 'ok', checklist: saved } : { kind: 'conflict' };
}
