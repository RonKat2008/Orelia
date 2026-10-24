import { describe, expect, it } from 'vitest';
import { approveApplication, type ApproveApplicationDeps } from '@/lib/web-application/approve';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import type { GatedDraft } from '@/lib/safety/outbound-gate';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { WebFormChannel } from '@/lib/channels/web-form';
import type { BrowserProvider, BrowserSession, PageField } from '@/lib/channels/browser-types';
import { fingerprintFields } from '@/lib/channels/browser-types';
import { gatedWeb, formFields, webGuard, FORM_URL } from '../channels/web-helpers';

const URL_ = 'http://localhost:3000/dev/test-application';
const NOW = new Date('2026-10-24T12:00:00Z');

function draft(): WebApplicationDraft {
  return {
    id: 'app-1', caseId: 'case-1', contactId: 'contact-1', url: URL_,
    fields: [
      { fieldKey: 'diagnosis', label: 'Diagnosis', type: 'text', value: 'Epithelioid sarcoma', source: { kind: 'consent', key: 'diseaseName' } },
      { fieldKey: 'notes', label: 'Anything else', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
    ],
    // The form's required name and authorization checkbox were never filled (not ticked / needs the patient).
    missing: [
      { fieldKey: 'fullName', label: 'Full name', required: true, reason: 'no_consented_source', question: 'What should we enter for "Full name"?' },
      { fieldKey: 'consentConfirm', label: 'I authorize this application', required: true, reason: 'needs_patient', question: 'Please confirm you authorize this application' },
    ],
    formFingerprint: 'f1-abc', screenshot: 'png', sharedFields: ['diseaseName'], sharedDocIds: [],
    status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: NOW.toISOString(),
  };
}

describe('approving an application with unanswered REQUIRED fields', () => {
  it('refuses (4xx, specific reason) instead of submitting and recording "submitted"', async () => {
    const applications = new MemoryApplicationStore();
    await applications.save(draft());
    const submitted: GatedDraft[] = [];
    const deps: ApproveApplicationDeps = {
      applications,
      outreach: {
        getCase: async () => ({ diseaseName: 'Epithelioid sarcoma' }),
        consent: async () => ({ sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' }),
        contacts: async () => [{ id: 'contact-1', caseId: 'case-1', state: 'drafted', address: 'intake@example.org' }],
      },
      submit: async g => { submitted.push(g); },
      env: { NODE_ENV: 'test', OUTBOUND_WEB_ALLOWLIST: 'localhost:3000' },
      clock: () => NOW,
    };
    const res = await approveApplication('app-1', {}, deps);
    // BUG: ok:true, status 'submitted', with the required name and authorization box empty.
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(submitted).toHaveLength(0);
    expect((await applications.get('app-1'))?.status).toBe('draft');
  });
});

/** A browser whose submit click lands back on the same form (HTML5 validation / server rejected it). */
class RejectingProvider implements BrowserProvider {
  readonly name = 'mock-browser' as const;
  readonly status = 'ready' as const;
  constructor(private fields: PageField[]) {}
  async launch(): Promise<BrowserSession> {
    const fields = this.fields;
    return {
      open: async (url: string) => ({ url, fields }),
      readFields: async () => ({ url: FORM_URL, fields }),
      fill: async () => undefined,
      upload: async () => undefined,
      screenshot: async () => 'png',
      submit: async () => ({ finalUrl: FORM_URL, confirmationText: 'Please fill in this field. This demo form is not accepting a submission right now.' }),
      close: async () => undefined,
    } as unknown as BrowserSession;
  }
}

describe('web form submit result', () => {
  it('does not report "submitted" when the submit click never left the form / the site rejected it', async () => {
    const channel = new WebFormChannel({ provider: new RejectingProvider(formFields), guard: webGuard });
    const gated = gatedWeb({ fingerprint: fingerprintFields(formFields) });
    // BUG: send() ignores the submit() outcome and always returns status 'submitted'; approveApplication then stores
    // the application as 'submitted'.
    await expect(channel.send(gated)).rejects.toThrow();
  });
});
