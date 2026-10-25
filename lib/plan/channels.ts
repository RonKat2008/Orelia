/**
 * Web-form channel port for contact-plan execution, backed by the Kernel cloud-browser channel
 * (lib/channels/kernel-web.ts). Shape:
 *   probeForm(url)        read-only: which fields the form has (never fills or submits)
 *   draftFill({...})      fills from the patient's TICKED fields + case-docs RAG, screenshots, persists a draft
 *                         application (status 'draft') and a "Review application" task. Idempotent per
 *                         case + contact + url. Never submits.
 *   submitGated(gated)    the only submit path; accepts only a GatedDraft minted by checkOutbound after the
 *                         patient approved the reviewed application (see lib/web-application/approve.ts).
 * With no KERNEL_API_KEY (and not offline) every call answers 'not_available' and nothing touches the network.
 */
import type { DocumentStore } from '../case-docs';
import type { PageField } from '../channels/browser-types';
import { withLiveViewScope } from '../channels/live-view';
import { draftFillWebForm, probeApplicationForm, submitGatedWebForm } from '../channels/kernel-web';
import type { WebFormChannel as BrowserWebFormChannel } from '../channels/web-form';
import { isGatedDraft, type GatedDraft } from '../safety/outbound-gate';
import type { CaseRecord } from '../safety/types';
import { getApplicationStore, type ApplicationStore } from '../web-application/store';
import { selectWebChannel } from '../outreach/channel-wiring';
import type { ApplicationStatus, WebApplicationDraft } from '../web-application/types';
import { demoDestinationsEnabled, demoFormUrl } from '../outreach/demo-destinations';
import { isDemoFormFor } from '../outreach/demo-destinations-shared';

export type NotAvailable = { ok: false; status: 'not_available'; reason: string };

export type ProbeResult = { ok: true; url: string; fields: PageField[]; formFingerprint: string } | NotAvailable;

export interface ApplicationDraftRef {
  applicationId: string;
  url: string;
  status: ApplicationStatus;
  missingCount: number;
}
export type DraftFillResult = { ok: true; draft: ApplicationDraftRef } | NotAvailable;

export type SubmitResult = { ok: true; status: 'submitted' } | NotAvailable;

export interface DraftFillInput {
  caseId: string;
  contactId: string | null;
  /** The plan step's targetRef: a code-stamped form URL of this resource. */
  url: string;
  /** `${targetKind}:${targetId}` of the plan resource; demo mode uses it to name the stand-in demo form. */
  resourceKey?: string;
}

export interface WebFormChannel {
  probeForm(url: string): Promise<ProbeResult>;
  draftFill(input: DraftFillInput): Promise<DraftFillResult>;
  /** Accepts only a gated payload; a raw draft is refused. */
  submitGated(gated: GatedDraft): Promise<SubmitResult>;
}

/** Server log for a failed browser step: error class and a short message with query strings (tokens) removed. */
function logBrowserFailure(step: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'unknown';
  const message = error instanceof Error ? error.message.replace(/\?[^\s]*/g, '?…').slice(0, 200) : '';
  console.error(`[plan-web-form] ${step} failed: ${name}: ${message}`);
}

const unavailable = (reason: string): NotAvailable => ({ ok: false, status: 'not_available', reason });

/** No browser automation: every call reports 'not_available' and performs no I/O. */
export class UnavailableWebFormChannel implements WebFormChannel {
  constructor(private readonly reason = 'Online form submission is not available in this environment') {}
  async probeForm(_url: string): Promise<ProbeResult> { return unavailable(this.reason); }
  async draftFill(_input: DraftFillInput): Promise<DraftFillResult> { return unavailable(this.reason); }
  async submitGated(_gated: GatedDraft): Promise<SubmitResult> { return unavailable(this.reason); }
}

export interface PlanWebFormContext {
  caseRecord: CaseRecord;
  /** The fields the patient ticked for this contact; nothing else may be filled. */
  sharedFields: string[];
}

export interface KernelPlanWebFormDeps {
  channel: () => BrowserWebFormChannel;
  applications: () => ApplicationStore;
  /** Case record + consented fields for the contact, or null when consent is missing. */
  context(input: { caseId: string; contactId: string | null }): Promise<PlanWebFormContext | null>;
  docStore?: DocumentStore;
  now?: () => Date;
  newId?: () => string;
  /** Defaults to process.env; read for demo destinations (the demo intake form). */
  env?: Record<string, string | undefined>;
}

/** Draft states that mean "this form was already prepared for this resource": never draft it twice. */
const LIVE_STATES = new Set<ApplicationStatus>(['draft', 'approved', 'submitting', 'submitted']);

const ref = (d: WebApplicationDraft): ApplicationDraftRef => ({ applicationId: d.id, url: d.url, status: d.status, missingCount: d.missing.length });

/** Errors from the browser are reduced to a fixed sentence; provider text never reaches the patient or logs. */
const BROWSER_FAILED = 'The online form could not be opened';

export class KernelPlanWebForm implements WebFormChannel {
  constructor(readonly deps: KernelPlanWebFormDeps) {}

  private ready(): BrowserWebFormChannel | null {
    const channel = this.deps.channel();
    return channel.status === 'ready' ? channel : null;
  }

  async probeForm(url: string): Promise<ProbeResult> {
    const channel = this.ready();
    if (!channel) return unavailable('Online forms are not configured (no cloud browser key)');
    try {
      const probe = await probeApplicationForm(channel, url);
      if (!probe.hasForm) return unavailable('No application form was found at this address');
      return { ok: true, url: probe.url, fields: [...probe.fields], formFingerprint: probe.formFingerprint };
    } catch {
      return unavailable(BROWSER_FAILED);
    }
  }

  async draftFill(input: DraftFillInput): Promise<DraftFillResult> {
    const channel = this.ready();
    if (!channel) return unavailable('Online forms are not configured (no cloud browser key)');
    const store = this.deps.applications();
    const env = this.deps.env ?? process.env;
    // Demo mode: the real form URL stays in the plan; the application is filled on Wayfinder's own demo intake form.
    const demo = demoDestinationsEnabled(env) && !!input.resourceKey;
    const sameForm = (a: WebApplicationDraft) => a.url === input.url || (!!input.resourceKey && isDemoFormFor(a.url, input.resourceKey, input.url));
    const existing = (await store.listByCase(input.caseId))
      .find(a => sameForm(a) && a.contactId === input.contactId && LIVE_STATES.has(a.status));
    if (existing) return { ok: true, draft: ref(existing) };
    const ctx = await this.deps.context({ caseId: input.caseId, contactId: input.contactId });
    if (!ctx) return unavailable('Choose what this contact may see before an application is filled');
    const id = this.deps.newId?.() ?? crypto.randomUUID();
    const url = demo ? demoFormUrl(env, { caseId: input.caseId, applicationId: id, resourceKey: input.resourceKey!, realUrl: input.url }) : input.url;
    let filled: Awaited<ReturnType<typeof draftFillWebForm>>;
    try {
      filled = await withLiveViewScope({ caseId: input.caseId, contactId: input.contactId ?? undefined, phase: 'filling' }, () => draftFillWebForm(channel, {
        url, caseId: input.caseId, ...(input.contactId ? { contactId: input.contactId } : {}),
        caseRecord: ctx.caseRecord, sharedFields: ctx.sharedFields, ...(this.deps.docStore ? { docStore: this.deps.docStore } : {}),
      }));
    } catch (error) {
      logBrowserFailure('draftFill', error);
      return unavailable(BROWSER_FAILED);
    }
    const draft: WebApplicationDraft = {
      id,
      caseId: input.caseId, contactId: input.contactId, url,
      fields: filled.filled, missing: filled.missing, formFingerprint: filled.formFingerprint, screenshot: filled.screenshot,
      sharedFields: [...ctx.sharedFields], sharedDocIds: [...filled.usedDocIds],
      status: 'draft', approvedAt: null, submittedAt: null, result: null,
      createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
    };
    const saved = await store.save(draft);
    await store.createReviewTask(saved);
    return { ok: true, draft: ref(saved) };
  }

  async submitGated(gated: GatedDraft): Promise<SubmitResult> {
    if (!isGatedDraft(gated) || gated.channel !== 'web_form') return unavailable('Only an approved, safety-checked application can be submitted');
    const channel = this.ready();
    if (!channel) return unavailable('Online forms are not configured (no cloud browser key)');
    const run = () => submitGatedWebForm(channel, gated);
    if (gated.caseId) await withLiveViewScope({ caseId: gated.caseId, contactId: gated.contactId, phase: 'submitting' }, run); else await run();
    return { ok: true, status: 'submitted' };
  }
}

/** Production wiring: Kernel (or the mock browser offline), the application store, Postgres consent. */
export function createDefaultPlanWebForm(): KernelPlanWebForm {
  let browser: BrowserWebFormChannel | undefined;
  return new KernelPlanWebForm({
    channel: () => (browser ??= selectWebChannel()),
    applications: () => getApplicationStore(),
    async context({ caseId, contactId }) {
      if (!contactId || !process.env.DATABASE_URL) return null;
      try {
        const { PostgresOutreachStore } = await import('../outreach/postgres-store');
        const store = new PostgresOutreachStore();
        const [consent, caseRecord] = await Promise.all([store.consent(contactId), store.getCase(caseId)]);
        return consent?.approvedAt && caseRecord ? { caseRecord, sharedFields: [...consent.sharedFields] } : null;
      } catch {
        return null;
      }
    },
  });
}

const g = globalThis as unknown as { __wayfinderWebFormChannel?: WebFormChannel };

export function getWebFormChannel(): WebFormChannel {
  g.__wayfinderWebFormChannel ??= createDefaultPlanWebForm();
  return g.__wayfinderWebFormChannel;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setWebFormChannelForTests(channel: WebFormChannel | undefined): void {
  if (channel) g.__wayfinderWebFormChannel = channel;
  else delete g.__wayfinderWebFormChannel;
}
