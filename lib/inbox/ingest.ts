import { FixtureClassifier, type ClassifyInput } from './classifier';
import type { InboxClassification } from './schema';

/** Reply or transcript that already passed signature checks and provider-id dedupe. */
export interface InboundInboxEvent {
  channel: 'email' | 'voice';
  contactId: string;
  caseId: string;
  body: string;
  providerId: string;
  subject?: string;
  from?: string;
}

/**
 * Classifies one verified, de-duplicated inbound message. Does not send anything
 * and does not invent contacts: unknown text stays `unclear` via the fixture classifier.
 */
export async function ingestInbound(event: InboundInboxEvent): Promise<InboxClassification> {
  const input: ClassifyInput = {
    channel: event.channel,
    body: event.body,
    ...(event.subject !== undefined ? { subject: event.subject } : {}),
    ...(event.from !== undefined ? { from: event.from } : {}),
  };
  return new FixtureClassifier().classify(input);
}
