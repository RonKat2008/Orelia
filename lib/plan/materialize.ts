/**
 * What approving a contact plan does right away (it still sends nothing):
 *   - email / voice steps that are ready now: one outbox draft per contact, written by the existing outreach draft
 *     and call-script builders from consented fields only, with the AI disclosure. Each draft still needs its own
 *     approval in the outbox, where checkOutbound runs before anything leaves.
 *   - web_form steps that are ready now: an application is filled (never submitted) and saved with a screenshot as
 *     a "Review application" draft.
 *   - follow_up steps: covered by the walk-away follow-up plan (pre-approved day-3/day-7 follow-ups), never here.
 *   - steps behind a business-day wait: left to the plan/approved workflow.
 * "Ready now" = enabled steps, in order, up to the first business-day wait.
 */
import { isExecutable } from './execute';
import { MAX_PLAN_RESOURCES, type ContactPlan, type PlanStep, type ResourcePlan } from './contract';
import type { WebFormChannel } from './channels';

export type MaterializedStatus =
  | 'drafted' | 'application_drafted' | 'scheduled' | 'follow_up_plan'
  | 'channel_mismatch' | 'no_contact' | 'blocked' | 'not_available' | 'error';

export interface MaterializedStep {
  resourceKey: string;
  stepId: string;
  channel: PlanStep['channel'];
  status: MaterializedStatus;
  draftId?: string;
  applicationId?: string;
  /** A reason code or fixed sentence; never provider text. */
  detail?: string;
}

export interface MaterializeDeps {
  contact(contactId: string): Promise<{ id: string; channel: 'email' | 'voice' } | undefined>;
  /** The existing outreach draft path (OutreachService.draft): consented fields only, disclosure included. */
  createDraft(contactId: string): Promise<{ id: string }>;
  webForm: WebFormChannel;
}

export function readySteps(resource: ResourcePlan): PlanStep[] {
  const ordered = [...resource.steps].filter(s => s.enabled).sort((a, b) => a.order - b.order);
  const wait = ordered.findIndex(s => s.waitFor.startsWith('business_days:'));
  return wait === -1 ? ordered : ordered.slice(0, wait);
}

function reasonCode(error: unknown): string {
  const reasons = (error as { reasons?: unknown })?.reasons;
  return Array.isArray(reasons) && typeof reasons[0] === 'string' ? reasons[0] : 'draft_failed';
}

async function materializeResource(caseId: string, resource: ResourcePlan, deps: MaterializeDeps): Promise<MaterializedStep[]> {
  const ready = new Set(readySteps(resource).map(s => s.id));
  const ordered = [...resource.steps].filter(s => s.enabled).sort((a, b) => a.order - b.order);
  let drafted = false;
  const out: MaterializedStep[] = [];
  for (const s of ordered) {
    const base = { resourceKey: resource.resourceKey, stepId: s.id, channel: s.channel };
    if (s.purpose === 'follow_up') { out.push({ ...base, status: 'follow_up_plan' }); continue; }
    if (!ready.has(s.id)) { out.push({ ...base, status: 'scheduled' }); continue; }
    if (s.channel === 'web_form') {
      const fill = await deps.webForm.draftFill({ caseId, contactId: resource.contactId, url: s.targetRef });
      out.push(fill.ok ? { ...base, status: 'application_drafted', applicationId: fill.draft.applicationId } : { ...base, status: 'not_available', detail: fill.reason });
      continue;
    }
    if (!resource.contactId) { out.push({ ...base, status: 'no_contact' }); continue; }
    // The outbox approves one first message per contact; a second ready message waits for the workflow.
    if (drafted) { out.push({ ...base, status: 'scheduled' }); continue; }
    const contact = await deps.contact(resource.contactId);
    if (!contact) { out.push({ ...base, status: 'no_contact' }); continue; }
    if (contact.channel !== s.channel) { out.push({ ...base, status: 'channel_mismatch', detail: `this contact is set up for ${contact.channel}` }); continue; }
    try {
      const draft = await deps.createDraft(contact.id);
      drafted = true;
      out.push({ ...base, status: 'drafted', draftId: draft.id });
    } catch (error) {
      out.push({ ...base, status: 'blocked', detail: reasonCode(error) });
    }
  }
  return out;
}

export async function materializeApprovedPlan(plan: ContactPlan, deps: MaterializeDeps): Promise<MaterializedStep[]> {
  if (!isExecutable(plan)) return [];
  const results = await Promise.all(plan.resources.slice(0, MAX_PLAN_RESOURCES).map(async r => {
    try {
      return await materializeResource(plan.caseId, r, deps);
    } catch {
      return [{ resourceKey: r.resourceKey, stepId: r.steps[0]?.id ?? 'none', channel: r.steps[0]?.channel ?? 'email', status: 'error' as const }];
    }
  }));
  return results.flat();
}
