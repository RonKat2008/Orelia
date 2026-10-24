/** Default dependencies for materializeApprovedPlan: the existing outreach draft path and the plan web-form port. */
import { getWebFormChannel } from './channels';
import { materializeApprovedPlan, type MaterializeDeps, type MaterializedStep } from './materialize';
import type { ContactPlan } from './contract';

export type PlanMaterializer = (plan: ContactPlan) => Promise<MaterializedStep[]>;

const service = async () => {
  const [{ PostgresOutreachStore }, { OutreachService }] = await Promise.all([import('../outreach/postgres-store'), import('../outreach/service')]);
  return new OutreachService(new PostgresOutreachStore(), []);
};

/** OutreachService.draft: consented fields only, AI disclosure, call script for voice. Reuses a pending draft. */
export async function defaultCreateDraft(contactId: string): Promise<{ id: string }> {
  const draft = await (await service()).draft(contactId);
  return { id: draft.id };
}

/** Plan-created verification requests share the diagnosis name only; the patient approves each call separately. */
export async function defaultCreateVerification(input: { caseId: string; resourceKey: string }): Promise<{ id: string }> {
  const { getVerificationService } = await import('../verification/server');
  const { request } = await (await getVerificationService()).create(input.caseId, { resourceKey: input.resourceKey, sharedFields: ['diseaseName'] });
  return { id: request.id };
}

function defaultDeps(): MaterializeDeps {
  return {
    async contact(id) {
      if (!process.env.DATABASE_URL) return undefined; // memory/demo mode has no contact rows
      const c = await (await service()).store.contact(id);
      return c ? { id: c.id, channel: c.channel } : undefined;
    },
    createDraft: defaultCreateDraft,
    webForm: getWebFormChannel(),
    createVerification: defaultCreateVerification,
  };
}

const defaultMaterializer: PlanMaterializer = plan => materializeApprovedPlan(plan, defaultDeps());
let materializer: PlanMaterializer = defaultMaterializer;

export function setPlanMaterializerForTests(m: PlanMaterializer | undefined): void {
  materializer = m ?? defaultMaterializer;
}

/** Never throws: a failure here must not undo or fail the patient's approval. */
export async function materializePlan(plan: ContactPlan): Promise<MaterializedStep[]> {
  try {
    return await materializer(plan);
  } catch (err) {
    console.error('[plan] drafting after approval failed', err instanceof Error ? err.name : 'unknown');
    return [];
  }
}
