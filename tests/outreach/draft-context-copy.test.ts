import { describe, expect, it } from 'vitest';
import { createDraft } from '../../lib/outreach/draft';
import { resourceContext, type ContextDocument } from '../../lib/outreach/call-script';
import type { Contact } from '../../lib/outreach/types';

const contact: Contact = { id: 'contact-a', caseId: 'case-a', targetId: 'resource', targetKind: 'institution', channel: 'email', address: 'intake@example.test', state: 'drafted' };
const consent = { contactId: contact.id, sharedFields: ['diseaseName'], approvedAt: '2026-10-23' };
const record = { diseaseName: 'synthetic disease' };
const doc = (id: string, content: string, sourceUrl = 'https://example.test/refer'): ContextDocument =>
  ({ id, caseId: contact.caseId, contactId: contact.id, kind: 'evidence', sharedField: null, content, sourceUrl });

describe('public intake context reads like a person wrote it', () => {
  it('labels the link "source", never the raw source_url field name', () => {
    const [line] = resourceContext(contact, consent, record, [doc('d1', 'Intake hours are Monday mornings.')]);
    expect(line.text).toBe('Intake hours are Monday mornings. (source: https://example.test/refer)');
    const draft = createDraft(contact, consent, record, [doc('d1', 'Intake hours are Monday mornings.')]);
    expect(draft.body).not.toContain('source_url');
  });

  it('formats a bare US E.164 number as a readable phone number', () => {
    const [line] = resourceContext(contact, consent, record, [doc('d1', '+15077384021')]);
    expect(line.text).toBe('Phone: +1 507-738-4021 (source: https://example.test/refer)');
  });

  it('leaves other content, including non-US numbers, unchanged', () => {
    const lines = resourceContext(contact, consent, record, [doc('d1', '+442071234567'), doc('d2', 'Call +15077384021 to refer.')]);
    expect(lines.map(l => l.text)).toEqual([
      '+442071234567 (source: https://example.test/refer)',
      'Call +15077384021 to refer. (source: https://example.test/refer)',
    ]);
  });
});
