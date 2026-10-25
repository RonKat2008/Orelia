import { createCallScript, renderCallScript, requestFor, resourceContext, sharedFieldLines, type ContextDocument } from './call-script';
import { withDisclosure } from '../safety/disclosure';
import type { CaseRecord } from '../safety/types';
import { OutreachError, type Contact, type Consent, type Draft } from './types';
export const SHARED_FIELDS = ['diseaseName', 'subtype', 'stageSummary', 'homeCity', 'homeState', 'insurer', 'planId', 'travelLimitMiles', 'goals'] as const;
export const INTAKE_SUBJECT = 'Patient intake inquiry';
/** Opening line: who is writing, for whom, and that the patient approved it. */
export const OUTREACH_INTRO = "I'm an AI assistant writing on behalf of a patient, who reviewed and approved this message.";
export const OUTREACH_REPLY_LINE = 'Nothing is attached. To respond, just reply to this email; if you need records or a referral, say so and the patient can arrange it.';
export function createDraft(contact: Contact, consent: Consent, record: CaseRecord, docs: readonly ContextDocument[] = []): Draft & { contextDocIds: string[] } {
  const context = resourceContext(contact, consent, record, docs);
  const details = sharedFieldLines(record, consent.sharedFields);
  const sections = [
    'Hello,',
    OUTREACH_INTRO,
    requestFor(contact, record, consent.sharedFields),
    details.length ? `Details the patient chose to share:\n${details.map(line => `- ${line}`).join('\n')}` : '',
    context.length ? `Public intake information we found (please correct us if it is out of date):\n${context.map(doc => `- ${doc.text}`).join('\n')}` : '',
    OUTREACH_REPLY_LINE,
    'Thank you for your time.',
  ];
  const body = sections.filter(Boolean).join('\n\n');
  if (contact.channel === 'web') throw new OutreachError(422, ['web_form_contact']);
  return { id: crypto.randomUUID(), contactId: contact.id, caseId: contact.caseId, channel: contact.channel, address: contact.address, subject: contact.channel === 'email' ? INTAKE_SUBJECT : undefined, body: contact.channel === 'voice' ? renderCallScript(createCallScript(contact, consent, record, docs)) : withDisclosure(body), contextDocIds: context.map(doc => doc.id), sharedFields: [...consent.sharedFields] };
}
