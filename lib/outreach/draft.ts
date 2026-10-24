import { minimize } from '../safety/minimize';
import { AI_DISCLOSURE_VOICE, withDisclosure } from '../safety/disclosure';
import type { CaseRecord } from '../safety/types';
import type { Contact, Consent, Draft } from './types';
export const SHARED_FIELDS = ['diseaseName', 'subtype', 'stageSummary', 'homeCity', 'homeState', 'insurer', 'planId', 'travelLimitMiles', 'goals'] as const;
const labels: Record<string, string> = { diseaseName: 'Diagnosis', subtype: 'Subtype', stageSummary: 'Stage summary', homeCity: 'Home city', homeState: 'Home state', insurer: 'Insurer', planId: 'Plan ID', travelLimitMiles: 'Travel limit (miles)', goals: 'Goals' };
export function createDraft(contact: Contact, consent: Consent, record: CaseRecord): Draft {
  const data = minimize(record, consent.sharedFields);
  const diagnosis = typeof data.diseaseName === 'string' ? data.diseaseName : 'my condition';
  const request = contact.targetKind === 'trial'
    ? 'I would like to contact your screening team. What is the process for an eligibility review?'
    : contact.targetKind === 'organization'
      ? contact.purpose === 'financial_aid' || contact.purpose === 'travel_aid'
        ? 'How can I apply for assistance, and what does the application process require?'
        : 'What support and resources are available, and how can I get started?'
      : `Do you see patients with ${diagnosis}, and what do you need to evaluate the case?`;
  const details = Object.entries(data).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${labels[key]}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join('\n');
  const body = `Hello,\n\n${request}${details ? `\n\n${details}` : ''}\n\nThank you.`;
  return { id: crypto.randomUUID(), contactId: contact.id, caseId: contact.caseId, channel: contact.channel, address: contact.address, subject: contact.channel === 'email' ? 'Patient intake inquiry' : undefined, body: contact.channel === 'voice' ? `${AI_DISCLOSURE_VOICE}\n\n${body}` : withDisclosure(body), sharedFields: [...consent.sharedFields] };
}
