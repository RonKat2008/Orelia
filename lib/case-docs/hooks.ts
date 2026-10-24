import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contacts } from '@/db/schema';
import { SHARED_FIELDS } from '@/lib/outreach/draft';
import { ingest } from './index';
import type { DocumentStore } from './store';

export async function ingestCaseSummary(caseRecord: { id: string; [field: string]: unknown }, store?: DocumentStore) {
  return (await Promise.all(SHARED_FIELDS.flatMap(field => {
    const value = caseRecord[field];
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return [];
    return [ingest({ caseId: caseRecord.id, kind: 'case_summary', title: field, sharedField: field,
      text: `${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}` }, store)];
  }))).flat();
}
export async function ingestEvidence(caseId: string, rows: readonly { claim: string; sourceUrl: string; claimType?: string }[], store?: DocumentStore) {
  return (await Promise.all(rows.map(row => ingest({ caseId, kind: 'evidence', title: row.claimType ?? 'Evidence',
    sourceUrl: row.sourceUrl, text: row.claim }, store)))).flat();
}
export interface InboundDocument {
  body?: string; transcript?: string; sharedField?: string; title?: string;
}
/** Resolve the owning case from the contact, never from inbound sender-controlled text. */
export async function ingestInbound(contactId: string, message: InboundDocument, options: {
  store?: DocumentStore; resolveContact?: (id: string) => Promise<{ caseId: string } | undefined>;
} = {}) {
  const resolve = options.resolveContact ?? (async (id: string) => {
    const [row] = await getDb().select({ caseId: contacts.caseId }).from(contacts).where(eq(contacts.id, id)).limit(1);
    return row;
  });
  const contact = await resolve(contactId);
  if (!contact) throw new Error('Contact not found');
  return ingest({ caseId: contact.caseId, contactId,
    kind: message.transcript !== undefined ? 'call_transcript' : 'inbound_message',
    title: message.title ?? 'Inbound correspondence', text: message.transcript ?? message.body ?? '',
    sharedField: message.sharedField,
  }, options.store);
}
