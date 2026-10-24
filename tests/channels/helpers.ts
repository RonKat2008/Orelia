import { checkOutbound, type GatedDraft } from '../../lib/safety/outbound-gate';
import { AI_DISCLOSURE_VOICE, withDisclosure } from '../../lib/safety/disclosure';

// Reserved test-only addresses (example.com, 555-01xx); never real recipients.
export const TEST_EMAIL = 'coordinator@example.com';
export const TEST_PHONE = '+12025550123';
export const allowlist = [TEST_EMAIL, TEST_PHONE];
export const guard = { allowlist };

export function gatedEmail(overrides: { contactId?: string; subject?: string; caseId?: string } = {}): GatedDraft {
  return gate({
    channel: 'email', address: TEST_EMAIL, subject: overrides.subject ?? 'Second opinion request',
    body: withDisclosure('Hello, I am coordinating a second opinion for a rare disease.'),
    ...(overrides.contactId ? { contactId: overrides.contactId } : {}),
    ...(overrides.caseId ? { caseId: overrides.caseId } : {}),
  });
}

export function gatedCall(): GatedDraft {
  return gate({ channel: 'voice', address: TEST_PHONE, body: `${AI_DISCLOSURE_VOICE} I am calling to ask how to schedule a new patient visit.` });
}

function gate(draft: Parameters<typeof checkOutbound>[0]['draft']): GatedDraft {
  const contacts = draft.contactId ? [{ id: draft.contactId, address: draft.address, state: 'drafted' }] : [];
  const result = checkOutbound({
    draft: { ...draft, approvedAt: '2026-10-28T15:00:00Z' }, consent: { sharedFields: ['diseaseName'] },
    caseRecord: { diseaseName: 'rare disease' }, contacts, allowlist, now: '2026-10-28T16:00:00Z', mode: 'demo',
  });
  if (!result.ok) throw new Error(`test draft refused: ${result.reasons.join(',')}`);
  return result.payload;
}

/** A hand-built object cast to GatedDraft, as a careless caller might; adapters must refuse it. */
export function forged(address = TEST_EMAIL): GatedDraft {
  return { channel: 'email', address, body: 'x', approvedAt: '2026-10-28T15:00:00Z', sharedFields: [], caseData: {} } as unknown as GatedDraft;
}

/** A hand-built voice payload (optionally without disclosure), as a careless caller might; adapters must refuse it. */
export function forgedCall(body = 'Hello there.'): GatedDraft {
  return Object.freeze({ channel: 'voice', address: TEST_PHONE, body, approvedAt: '2026-10-28T15:00:00Z', sharedFields: [], caseData: {} }) as unknown as GatedDraft;
}
