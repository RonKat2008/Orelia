import { checkOutbound, type GatedDraft, type OutboundInput } from '../../lib/safety/outbound-gate';
import { fingerprintFields, type PageField } from '../../lib/channels/browser-types';
import { AI_DISCLOSURE_EMAIL } from '../../lib/safety/disclosure';

export const FORM_URL = 'http://localhost:3000/dev/test-application';
export const webGuard = { allowlist: [] as string[], webAllowlist: ['localhost:3000'] };

export const formFields: PageField[] = [
  { key: 'fullName', label: 'Full name', type: 'text', required: true },
  { key: 'notes', label: 'Anything else you want to tell us', type: 'textarea', required: false },
  { key: 'documents', label: 'Documents', type: 'file', required: false },
  { key: 'consentConfirm', label: 'I authorize this application', type: 'checkbox', required: true },
];

/** Builds a valid web_form OutboundInput (depends on the web branch of checkOutbound). */
export function webInput(overrides: { url?: string; fields?: PageField[]; fingerprint?: string; uploads?: boolean } = {}): OutboundInput {
  const fields = overrides.fields ?? formFields;
  const url = overrides.url ?? FORM_URL;
  return {
    draft: {
      channel: 'web_form', address: url, body: 'Application form: fullName, notes, consent', approvedAt: '2026-10-28T15:00:00Z',
      webForm: {
        formFingerprint: overrides.fingerprint ?? fingerprintFields(fields),
        fields: [
          { fieldKey: 'fullName', label: 'Full name', type: 'text', value: 'Pat Example', source: { kind: 'consent', key: 'patientName' } },
          { fieldKey: 'notes', label: 'Anything else you want to tell us', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
          { fieldKey: 'consentConfirm', label: 'I authorize this application', type: 'checkbox', value: true, source: { kind: 'consent', key: 'authorize' } },
        ],
        uploads: overrides.uploads ? [{ fieldKey: 'documents', docId: 'doc-1', name: 'records.pdf' }] : [],
        hasFreeText: true,
      },
    },
    consent: { sharedFields: ['patientName', 'authorize'], sharedDocIds: ['doc-1'] },
    caseRecord: { patientName: 'Pat Example', authorize: true },
    contacts: [], allowlist: [], webAllowlist: ['localhost:3000'], now: '2026-10-28T16:00:00Z', mode: 'demo',
  } as unknown as OutboundInput;
}

export function gatedWeb(overrides: Parameters<typeof webInput>[0] = {}): GatedDraft {
  const result = checkOutbound(webInput(overrides));
  if (!result.ok) throw new Error(`test web draft refused: ${result.reasons.join(',')}`);
  return result.payload;
}

export function forgedWeb(): GatedDraft {
  return Object.freeze({ channel: 'web_form', address: FORM_URL, body: 'x', approvedAt: '2026-10-28T15:00:00Z', sharedFields: [], caseData: {},
    webForm: { formFingerprint: 'x', fields: [], uploads: [], hasFreeText: false } }) as unknown as GatedDraft;
}
