import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import { neutralizeUntrusted } from '../agents/research/untrusted';
import { LETTER_INTRO, LETTER_REPLY_LINE } from '../inbox/drafts';
import { checkOutbound, withDisclosure, type CaseRecord } from '../safety';
import type { OutboundThreadRef } from '../channels/types';
import type { GatedDraft } from '../safety/outbound-gate';
import type { Consent, Contact, ProviderRef } from '../outreach/types';
import { KIND_LABELS, type Appointment } from './schema';
import { formatInZone } from './timezone';

/**
 * Reschedule / cancel requests. Wayfinder drafts a short message to the office; it is sent only when the patient
 * approves it, and only through checkOutbound (allowlist, consent fields, disclosure, cadence, cap, advice filter).
 */
export const REQUEST_CLASSIFICATION = 'appointment_request';
export type RequestKind = 'reschedule' | 'cancel';

export interface RequestDraft { subject: string; body: string }

export function draftRequest(appt: Appointment, kind: RequestKind, opts: { note?: string; freeTimes?: string[] } = {}): RequestDraft {
  const when = appt.startsAt ? formatInZone(appt.startsAt, appt.timezone) : 'the proposed time';
  const what = KIND_LABELS[appt.kind].toLowerCase();
  const lead = kind === 'cancel'
    ? `The patient needs to cancel the ${what} on ${when}. Thank you for holding the time.`
    : `The patient needs to reschedule the ${what} on ${when}. Could you suggest another time?`;
  const free = kind === 'reschedule' && opts.freeTimes?.length ? `Times that currently work for the patient:\n${opts.freeTimes.map(t => `- ${t}`).join('\n')}` : '';
  const note = opts.note?.trim() ? `A note from the patient: ${neutralizeUntrusted(opts.note).slice(0, 500)}` : '';
  const body = ['Hello,', LETTER_INTRO, lead, free, note, LETTER_REPLY_LINE, 'Thank you for your help.'].filter(Boolean).join('\n\n');
  const subject = `${kind === 'cancel' ? 'Cancellation' : 'Reschedule request'}: ${what} on ${when}`;
  return { subject, body: withDisclosure(body) };
}

export interface RequestMessage { id: string; contactId: string; subject: string | null; body: string; approvedAt: string | null; sentAt: string | null }

export interface RequestDeps {
  saveDraft(input: { contactId: string; subject: string; body: string; sharedFields: string[] }): Promise<string>;
  message(id: string, contactId: string): Promise<RequestMessage | undefined>;
  /** approved_at NULL -> at while unsent (compare-and-set). */
  approve(id: string, contactId: string, at: string): Promise<boolean>;
  withdraw(id: string, contactId: string): Promise<void>;
  delivered(id: string, ref: ProviderRef, at: string): Promise<void>;
  /** Most recent provider message on the contact's thread, to reply in-thread. */
  thread(contactId: string): Promise<OutboundThreadRef | null>;
  contact(id: string): Promise<Contact | undefined>;
  contacts(caseId: string): Promise<(Contact & { firstSentAt?: string | Date | null })[]>;
  consent(contactId: string): Promise<Consent | undefined>;
  getCase(caseId: string): Promise<CaseRecord | undefined>;
  send(gated: GatedDraft, thread: OutboundThreadRef | null): Promise<ProviderRef>;
  env: Record<string, string | undefined>;
  allowlist: string[];
  clock?: () => Date;
}

export class RequestError extends Error {
  constructor(readonly status: number, readonly reasons: string[]) { super(reasons.join(', ')); this.name = 'RequestError'; }
}

export async function createRequestDraft(appt: Appointment, kind: RequestKind, deps: Pick<RequestDeps, 'saveDraft' | 'contact' | 'consent'>, opts: { note?: string; freeTimes?: string[] } = {}): Promise<{ messageId: string; draft: RequestDraft }> {
  if (!appt.contactId) throw new RequestError(422, ['no_contact']);
  const contact = await deps.contact(appt.contactId);
  if (!contact || contact.caseId !== appt.caseId) throw new RequestError(422, ['no_contact']);
  if (contact.channel !== 'email') throw new RequestError(422, ['call_the_office']);
  const consent = await deps.consent(contact.id);
  if (!consent?.approvedAt) throw new RequestError(422, ['consent_required']);
  const draft = draftRequest(appt, kind, opts);
  const messageId = await deps.saveDraft({ contactId: contact.id, subject: draft.subject, body: draft.body, sharedFields: [...consent.sharedFields] });
  return { messageId, draft };
}

/** Patient approval of a drafted request: CAS approval, then the outbound gate, then a single in-thread send. */
export async function approveAndSendRequest(appt: Appointment, deps: RequestDeps): Promise<{ sentAt: string; provider: ProviderRef }> {
  if (!appt.contactId || !appt.requestMessageId) throw new RequestError(404, ['no_request']);
  const message = await deps.message(appt.requestMessageId, appt.contactId);
  if (!message) throw new RequestError(404, ['no_request']);
  if (message.sentAt || message.approvedAt) throw new RequestError(409, ['already_approved']);
  const contact = await deps.contact(appt.contactId);
  if (!contact) throw new RequestError(404, ['no_contact']);
  const consent = await deps.consent(contact.id);
  if (!consent?.approvedAt) throw new RequestError(422, ['consent_required']);
  const caseRecord = await deps.getCase(appt.caseId);
  if (!caseRecord) throw new RequestError(404, ['case_not_found']);
  const now = (deps.clock?.() ?? new Date()).toISOString();
  const all = await deps.contacts(appt.caseId);
  // Same cadence anchor as follow-ups: the first send.
  const contacts = all.map(c => ({ ...c, lastSentAt: (c.firstSentAt ? new Date(c.firstSentAt).toISOString() : c.lastSentAt) ?? null, followUpsSent: c.followUpsSent ?? 0 }));
  const gate = checkOutbound({
    draft: { channel: 'email', address: contact.address, body: message.body, ...(message.subject ? { subject: message.subject } : {}), contactId: contact.id, caseId: appt.caseId, approvedAt: now, isFollowUp: true },
    consent, caseRecord, contacts, allowlist: deps.allowlist, now, mode: deps.env.NODE_ENV === 'production' ? 'prod' : 'dev',
    outboundAllowReal: deps.env.OUTBOUND_ALLOW_REAL,
  });
  if (!gate.ok) throw new RequestError(422, [...gate.reasons]);
  if (!await deps.approve(message.id, contact.id, now)) throw new RequestError(409, ['already_approved']);
  try {
    const provider = await deps.send(gate.payload, await deps.thread(contact.id));
    await deps.delivered(message.id, provider, now);
    return { sentAt: now, provider };
  } catch (error) {
    // Nothing reached the provider in a refusal; never auto-retry an ambiguous send.
    await deps.withdraw(message.id, contact.id);
    throw error;
  }
}

/** Postgres pieces of RequestDeps (messages rows with classification appointment_request). */
export function postgresRequestMessages(): Pick<RequestDeps, 'saveDraft' | 'message' | 'approve' | 'withdraw' | 'delivered' | 'thread'> {
  const db = () => getDb();
  return {
    async saveDraft(input) {
      const [row] = await db().insert(s.messages).values({ contactId: input.contactId, channel: 'email', direction: 'outbound', subject: input.subject, body: input.body, sharedFields: input.sharedFields, classification: REQUEST_CLASSIFICATION }).returning({ id: s.messages.id });
      return row.id;
    },
    async message(id, contactId) {
      const [r] = await db().select().from(s.messages).where(and(eq(s.messages.id, id), eq(s.messages.contactId, contactId), eq(s.messages.direction, 'outbound'), eq(s.messages.classification, REQUEST_CLASSIFICATION))).limit(1);
      return r ? { id: r.id, contactId: r.contactId, subject: r.subject, body: r.body, approvedAt: r.approvedAt?.toISOString() ?? null, sentAt: r.sentAt?.toISOString() ?? null } : undefined;
    },
    async approve(id, contactId, at) {
      const rows = await db().update(s.messages).set({ approvedAt: new Date(at) }).where(and(eq(s.messages.id, id), eq(s.messages.contactId, contactId), eq(s.messages.classification, REQUEST_CLASSIFICATION), isNull(s.messages.approvedAt), isNull(s.messages.sentAt))).returning({ id: s.messages.id });
      return rows.length === 1;
    },
    async withdraw(id, contactId) {
      await db().update(s.messages).set({ approvedAt: null }).where(and(eq(s.messages.id, id), eq(s.messages.contactId, contactId), eq(s.messages.classification, REQUEST_CLASSIFICATION), isNull(s.messages.sentAt)));
    },
    async delivered(id, ref, at) {
      await db().update(s.messages).set({ sentAt: new Date(at), providerMessageId: ref.messageId ?? null, providerThreadId: sql`COALESCE(${ref.threadId ?? null}, ${s.messages.providerThreadId})` }).where(eq(s.messages.id, id));
    },
    async thread(contactId) {
      const [r] = await db().select({ messageId: s.messages.providerMessageId, threadId: s.messages.providerThreadId }).from(s.messages)
        .where(and(eq(s.messages.contactId, contactId), isNotNull(s.messages.providerMessageId))).orderBy(desc(sql`COALESCE(${s.messages.receivedAt}, ${s.messages.sentAt})`)).limit(1);
      return r?.messageId ? { messageId: r.messageId, ...(r.threadId ? { threadId: r.threadId } : {}) } : null;
    },
  };
}
