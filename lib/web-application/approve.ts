/**
 * Patient approval of a drafted online application ("Review application" in the outbox). Order matters:
 *   1. checkOutbound on exactly the reviewed fields (web allowlist, ticked fields only, ticked documents only, AI
 *      disclosure, no medical advice, <=5 contacts). A refusal changes nothing, so the draft stays reviewable.
 *   2. compare-and-set draft -> approved, then approved -> submitting (a double click cannot submit twice).
 *   3. submit the GatedDraft; the channel refuses if the live form no longer matches the reviewed fingerprint.
 * Provider errors are reduced to fixed reason codes before they reach the caller or the stored result.
 */
import { PageChangedError } from '../channels/web-form';
import { webAllowlist } from '../outreach/demo-destinations';
import { checkOutbound, type GatedDraft } from '../safety/outbound-gate';
import type { CaseRecord, SafetyContact, WebFormDraftPayload } from '../safety/types';
import { usedAnswers } from './answers';
import type { ApplicationStore } from './store';
import type { ApplicationStatus, WebApplicationDraft } from './types';

type Env = Record<string, string | undefined>;

export interface ApproveApplicationDeps {
  applications: ApplicationStore;
  outreach: {
    getCase(caseId: string): Promise<CaseRecord | undefined>;
    consent(contactId: string): Promise<{ sharedFields: string[]; approvedAt: string } | undefined>;
    contacts(caseId: string): Promise<readonly SafetyContact[]>;
  };
  /** Sends a GatedDraft through the web channel; throws on failure. */
  submit(gated: GatedDraft): Promise<void>;
  env?: Env;
  clock?: () => Date;
}

export interface ApproveApplicationInput {
  /** Case documents the patient ticked for this application; defaults to the documents its values came from. */
  sharedDocIds?: readonly string[];
}

export type ApproveApplicationResult =
  | { ok: true; applicationId: string; status: Extract<ApplicationStatus, 'submitted'>; approvedAt: string; submittedAt: string }
  | { ok: false; status: number; reasons: string[] };

const fail = (status: number, ...reasons: string[]): ApproveApplicationResult => ({ ok: false, status, reasons });

export function usedDocIds(draft: Pick<WebApplicationDraft, 'fields'>): string[] {
  return [...new Set(draft.fields.flatMap(f => (f.source.kind === 'doc' ? [f.source.docId] : [])))];
}

function webForm(draft: WebApplicationDraft): WebFormDraftPayload {
  return {
    formFingerprint: draft.formFingerprint,
    fields: draft.fields,
    uploads: [],
    // The disclosure is written into the first non-medical textarea whenever one exists, so a filled textarea is
    // exactly the case in which free text leaves the system.
    hasFreeText: draft.fields.some(f => f.type === 'textarea'),
  };
}

function summary(draft: WebApplicationDraft): string {
  return `Application form at ${draft.url}: ${draft.fields.map(f => f.label || f.fieldKey).join(', ')}`;
}

export async function approveApplication(id: string, input: ApproveApplicationInput, deps: ApproveApplicationDeps): Promise<ApproveApplicationResult> {
  const env = deps.env ?? process.env;
  const now = (deps.clock ?? (() => new Date()))().toISOString();
  const draft = await deps.applications.get(id);
  if (!draft) return fail(404, 'application_not_found');
  if (draft.status !== 'draft') return fail(409, 'already_approved');
  const consent = draft.contactId ? await deps.outreach.consent(draft.contactId) : undefined;
  if (!consent?.approvedAt) return fail(422, 'consent_required');
  const caseRecord = await deps.outreach.getCase(draft.caseId);
  if (!caseRecord) return fail(404, 'case_not_found');
  // A required field the form still needs can't be left blank: the site would reject it or record a hollow application.
  if (draft.missing.some(m => m.required)) return fail(422, 'required_fields_missing');
  const sharedDocIds = [...(input.sharedDocIds ?? usedDocIds(draft))];

  // The form URL is not the contact's email/phone address, so the gate sees the application as its own draft
  // (no contactId). The five-contact cap counts resources: passing the contact's targetId means an application to a
  // resource the patient already contacts is not a new contact. The consent used is the one for this contact.
  const contacts = await deps.outreach.contacts(draft.caseId);
  const targetId = contacts.find(c => c.id === draft.contactId)?.targetId;
  const gate = checkOutbound({
    draft: {
      channel: 'web_form', address: draft.url, body: summary(draft), caseId: draft.caseId, approvedAt: now, webForm: webForm(draft),
      ...(targetId ? { targetId } : {}),
    },
    caseRecord,
    // The patient's own answers on THIS application (never another one's) are the consent for 'patient' fields.
    consent: { sharedFields: consent.sharedFields, sharedDocIds, formAnswers: usedAnswers(draft) },
    contacts,
    allowlist: [],
    // OUTBOUND_WEB_ALLOWLIST, plus (demo mode only) this deployment's own host for the demo intake form.
    webAllowlist: webAllowlist(env),
    now,
    mode: env.NODE_ENV === 'production' ? 'prod' : 'dev',
    outboundAllowReal: env.OUTBOUND_ALLOW_REAL,
  });
  if (!gate.ok) return fail(422, ...gate.reasons);

  if (!await deps.applications.approve(id, { approvedAt: now, sharedFields: consent.sharedFields, sharedDocIds })) return fail(409, 'already_approved');
  if (!await deps.applications.claimSubmit(id)) return fail(409, 'already_approved');
  try {
    await deps.submit(gate.payload);
  } catch (error) {
    if (error instanceof PageChangedError) {
      await deps.applications.finish(id, 'stale', { reason: 'page_changed' }, now);
      return fail(409, 'page_changed');
    }
    await deps.applications.finish(id, 'failed', { reason: 'submit_failed' }, now);
    console.error('[applications] submit failed', error instanceof Error ? error.name : 'unknown');
    return fail(502, 'submit_failed');
  }
  await deps.applications.finish(id, 'submitted', { reason: 'submitted' }, now);
  return { ok: true, applicationId: id, status: 'submitted', approvedAt: now, submittedAt: now };
}
