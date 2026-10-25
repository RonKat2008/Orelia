/**
 * ContactPlan contract: for each resource the patient selected, HOW Orelia will reach it (email, call, online
 * form or a combination), in what order, and why. A plan is a proposal the patient reviews; it never sends anything.
 * Every outbound step still goes through the existing approval + checkOutbound gate when it is executed.
 *
 * targetRef rules (enforced by the planner, re-checked by validatePlanAgainstInputs):
 *   - email / voice: the id of a code-stamped `contact_point.<channel>.<origin>` evidence row of that resource.
 *   - web_form: the URL claim of a code-stamped `contact_point.web_form.<origin>` evidence row of that resource.
 * evidenceIds must be ids of evidence rows of that same resource (never invented).
 */
import { z } from 'zod';
import { sourceKindSchema, type SourceKind } from '../contracts/evidence';

export const MAX_PLAN_RESOURCES = 5;
export const MAX_STEPS_PER_RESOURCE = 6;

export const planChannelSchema = z.enum(['email', 'voice', 'web_form']);
/** 'verify' = an AI verification call (lib/verification): creates a request that waits for patient approval; never sends by itself. */
export const stepPurposeSchema = z.enum(['intro', 'apply', 'follow_up', 'confirm', 'verify']);
export const targetKindSchema = z.enum(['expert', 'institution', 'trial', 'organization']);

/** 'none' = run right after the previous step; 'reply' = only if no reply yet, wait for one; business_days:N = no reply after N business days. */
export const waitForSchema = z.union([
  z.literal('none'),
  z.literal('reply'),
  z.string().regex(/^business_days:(?:[1-9]|1\d|20)$/, 'waitFor must be none, reply or business_days:1..20'),
]);

export const planStepSchema = z.object({
  /** Stable within a resource plan; code-assigned (e.g. "s1"). */
  id: z.string().min(1).max(40),
  channel: planChannelSchema,
  /** 1-based, contiguous within a resource plan. */
  order: z.number().int().min(1).max(MAX_STEPS_PER_RESOURCE),
  purpose: stepPurposeSchema,
  targetRef: z.string().min(1).max(2048),
  reason: z.string().min(1).max(400),
  evidenceIds: z.array(z.string().min(1)).min(1).max(10),
  waitFor: waitForSchema,
  /** Patient toggle; disabled steps are skipped at execution time. */
  enabled: z.boolean(),
});

export const resourcePlanSchema = z.object({
  /** `${targetKind}:${targetId}` */
  resourceKey: z.string().min(3),
  targetKind: targetKindSchema,
  targetId: z.string().min(1),
  name: z.string().min(1),
  /** The contacts row for this resource, when one exists (selection creates it). */
  contactId: z.string().min(1).nullable(),
  /** Which deterministic rule produced the steps (e.g. "financial_aid_apply"), for audit and tests. */
  rule: z.string().min(1),
  steps: z.array(planStepSchema).max(MAX_STEPS_PER_RESOURCE),
  /** Set when no tool-sourced channel exists; steps is then empty. */
  unavailableReason: z.string().min(1).nullable(),
}).superRefine((r, ctx) => {
  const orders = r.steps.map(s => s.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i + 1)) ctx.addIssue({ code: 'custom', message: 'step orders must be contiguous from 1' });
  if (new Set(r.steps.map(s => s.id)).size !== r.steps.length) ctx.addIssue({ code: 'custom', message: 'step ids must be unique' });
  if (r.resourceKey !== `${r.targetKind}:${r.targetId}`) ctx.addIssue({ code: 'custom', message: 'resourceKey must be targetKind:targetId' });
});

export const planStatusSchema = z.enum(['draft', 'approved']);
export const planSourceSchema = z.enum(['rules', 'rules+llm']);

export const contactPlanSchema = z.object({
  caseId: z.string().min(1),
  /** Increments on every saved change; PATCH must send the version it edited (optimistic concurrency). */
  version: z.number().int().min(1),
  status: planStatusSchema,
  source: planSourceSchema,
  summary: z.string().min(1).max(1200),
  resources: z.array(resourcePlanSchema).max(MAX_PLAN_RESOURCES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
});

export type PlanChannel = z.infer<typeof planChannelSchema>;
export type StepPurpose = z.infer<typeof stepPurposeSchema>;
export type WaitFor = z.infer<typeof waitForSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type ResourcePlan = z.infer<typeof resourcePlanSchema>;
export type ContactPlan = z.infer<typeof contactPlanSchema>;
export type PlanTargetKind = z.infer<typeof targetKindSchema>;

/** Evidence row as the planner sees it (id is required: steps cite ids). */
export interface PlanEvidence {
  id: string;
  claimType: string;
  claim: string;
  sourceUrl: string;
  sourceKind: SourceKind;
}

/** One selected resource, with ALL of its evidence rows (the planner reads contact_point.* rows from them). */
export interface PlanResourceInput {
  targetKind: PlanTargetKind;
  targetId: string;
  name: string;
  contactId: string | null;
  /** organizationKind (advocacy | financial_aid | travel_aid) or institutionKind, when known. */
  subKind?: string | null;
  evidence: PlanEvidence[];
}

export const planEvidenceSchema = z.object({
  id: z.string().min(1),
  claimType: z.string().min(1),
  claim: z.string().min(1),
  sourceUrl: z.string().min(1),
  sourceKind: sourceKindSchema,
});

/** Patient edits accepted by PATCH /api/cases/[id]/plan. */
export const planEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('toggle'), resourceKey: z.string().min(3), stepId: z.string().min(1), enabled: z.boolean() }),
  /** Full new order of step ids for one resource (must be a permutation of its current step ids). */
  z.object({ type: z.literal('reorder'), resourceKey: z.string().min(3), stepIds: z.array(z.string().min(1)).min(1).max(MAX_STEPS_PER_RESOURCE) }),
  z.object({ type: z.literal('approve') }),
]);
export type PlanEdit = z.infer<typeof planEditSchema>;

export const planPatchBodySchema = z.object({
  version: z.number().int().min(1),
  edits: z.array(planEditSchema).min(1).max(40),
});
export type PlanPatchBody = z.infer<typeof planPatchBodySchema>;

/** Persistence port. One current plan per case. */
export interface PlanStore {
  latest(caseId: string): Promise<ContactPlan | null>;
  /**
   * Insert or replace the case's plan. When expectedVersion is given, the write only succeeds if the stored plan
   * still has that version (returns null on conflict).
   */
  save(plan: ContactPlan, expectedVersion?: number): Promise<ContactPlan | null>;
}
