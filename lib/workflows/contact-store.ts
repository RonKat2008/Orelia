/**
 * Durable contact context. The machine's ContactContext is persisted on the
 * contacts row; derived fields (lastOutboundAt, followUpsDue) come from the
 * messages table. This module never sends anything.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import { AI_DISCLOSURE_VOICE, withDisclosure } from '../safety/disclosure';
import { initialContext, type ContactContext, type ContactState } from './connection-machine';

export interface ContactContextStore {
  load(contactId: string): Promise<ContactContext>;
  save(contactId: string, ctx: ContactContext): Promise<void>;
  createFollowUpDraft(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
  }): Promise<{ messageId: string }>;
  loadMessageApproval(messageId: string): Promise<string | null>;
  loadThread(contactId: string): Promise<{ inboxId?: string; threadId?: string; messageId: string } | null>;
}

export interface ContactRowLike {
  state: ContactState;
  firstSentAt: Date | null;
  followUpsSent: number;
  nextFollowUpAt: Date | null;
  lastActivityAt: Date | null;
}
export interface OutboundMessageLike {
  sentAt: Date | null;
  classification: string | null;
}

export function deriveContext(row: ContactRowLike, outbound: OutboundMessageLike[]): ContactContext {
  const sentTimes = outbound
    .map((m) => m.sentAt)
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  const lastOutboundAt = sentTimes.length ? new Date(Math.max(...sentTimes)) : null;
  let firstSentAt = row.firstSentAt;
  if (!firstSentAt && row.state !== 'drafted' && sentTimes.length) {
    firstSentAt = new Date(Math.min(...sentTimes));
  }
  const followUpsDue = outbound.filter((m) => m.classification?.startsWith('follow_up_')).length;
  return {
    state: row.state,
    firstSentAt,
    lastOutboundAt,
    lastActivityAt: row.lastActivityAt,
    followUpsDue,
    followUpsSent: row.followUpsSent,
    nextFollowUpAt: row.nextFollowUpAt,
  };
}

export const FOLLOW_UP_SUBJECT = 'Re: Patient intake inquiry';
/**
 * Deliberately contains no case details, so a follow-up can never leak an unticked field. The same text is used for
 * the business-day 3 and day 7 follow-ups, so a patient can review and pre-approve it once.
 */
export const FOLLOW_UP_BODY =
  'Hello,\n\nI am following up on an earlier message sent on behalf of a patient who would like to connect with your team. Could you let us know the next step, or the right person to contact?\n\nThank you for your time.';

export function followUpContent(channel: 'email' | 'voice'): { subject?: string; body: string } {
  return channel === 'email'
    ? { subject: FOLLOW_UP_SUBJECT, body: withDisclosure(FOLLOW_UP_BODY) }
    : { body: `${AI_DISCLOSURE_VOICE}\n\n${FOLLOW_UP_BODY}` };
}

export class PostgresContactContextStore implements ContactContextStore {
  private get db() {
    return getDb();
  }

  private async outbound(contactId: string) {
    return this.db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.contactId, contactId), eq(s.messages.direction, 'outbound')))
      .orderBy(asc(s.messages.sentAt));
  }

  async load(contactId: string): Promise<ContactContext> {
    const [row] = await this.db.select().from(s.contacts).where(eq(s.contacts.id, contactId));
    if (!row) throw new Error(`Contact ${contactId} not found`);
    return deriveContext(row, await this.outbound(contactId));
  }

  async save(contactId: string, ctx: ContactContext): Promise<void> {
    await this.db
      .update(s.contacts)
      .set({
        state: ctx.state,
        firstSentAt: ctx.firstSentAt,
        followUpsSent: ctx.followUpsSent,
        nextFollowUpAt: ctx.nextFollowUpAt,
        lastActivityAt: ctx.lastActivityAt,
      })
      .where(eq(s.contacts.id, contactId));
  }

  async createFollowUpDraft(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
  }): Promise<{ messageId: string }> {
    const classification = `follow_up_${input.followUpNumber}`;
    const [contact] = await this.db.select().from(s.contacts).where(eq(s.contacts.id, input.contactId));
    if (!contact) throw new Error(`Contact ${input.contactId} not found`);
    // A web-form contact is followed up through its application, never with an email or a call.
    if (contact.channel === 'web') throw new Error(`Contact ${input.contactId} is a web-form contact; no follow-up message`);
    const channel = contact.channel;
    const out = await this.outbound(input.contactId);
    const existing = out.find((m) => m.classification === classification);
    if (existing) return { messageId: existing.id };

    const [consent] = await this.db.select().from(s.consents).where(eq(s.consents.contactId, input.contactId));
    const initial = out.find((m) => !m.classification?.startsWith('follow_up_'));
    const { subject, body } = followUpContent(channel);
    const [created] = await this.db
      .insert(s.messages)
      .values({
        contactId: input.contactId,
        direction: 'outbound',
        channel,
        providerThreadId: initial?.providerThreadId ?? null,
        subject: subject ?? null,
        body,
        sharedFields: consent?.sharedFields ?? [],
        approvedAt: null,
        sentAt: null,
        classification,
      })
      .returning({ id: s.messages.id });
    return { messageId: created.id };
  }

  async loadMessageApproval(messageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ approvedAt: s.messages.approvedAt })
      .from(s.messages)
      .where(eq(s.messages.id, messageId));
    return row?.approvedAt ? row.approvedAt.toISOString() : null;
  }

  async loadThread(contactId: string): Promise<{ threadId?: string; messageId: string } | null> {
    const outbound = await this.outbound(contactId);
    const hit = [...outbound].reverse().find((m) => m.providerMessageId);
    if (!hit?.providerMessageId) return null;
    return {
      messageId: hit.providerMessageId,
      ...(hit.providerThreadId ? { threadId: hit.providerThreadId } : {}),
    };
  }
}

export class InMemoryContactContextStore implements ContactContextStore {
  contexts = new Map<string, ContactContext>();
  drafts: { messageId: string; contactId: string; followUpNumber: 1 | 2 }[] = [];
  /** messages.approved_at. Absent means the row was never approved. */
  approvals = new Map<string, string>();
  threads = new Map<string, { inboxId?: string; threadId?: string; messageId: string }>();
  private seq = 0;

  load(contactId: string): Promise<ContactContext> {
    return Promise.resolve(structuredClone(this.contexts.get(contactId) ?? initialContext()));
  }
  save(contactId: string, ctx: ContactContext): Promise<void> {
    this.contexts.set(contactId, structuredClone(ctx));
    return Promise.resolve();
  }
  createFollowUpDraft(input: { contactId: string; caseId: string; followUpNumber: 1 | 2 }) {
    const found = this.drafts.find(
      (d) => d.contactId === input.contactId && d.followUpNumber === input.followUpNumber,
    );
    if (found) return Promise.resolve({ messageId: found.messageId });
    this.seq += 1;
    const messageId = `fu-${input.contactId}-${input.followUpNumber}-${this.seq}`;
    this.drafts.push({ messageId, contactId: input.contactId, followUpNumber: input.followUpNumber });
    // Mirror the Postgres derivation: a created draft counts as due.
    const ctx = this.contexts.get(input.contactId);
    if (ctx) ctx.followUpsDue = Math.max(ctx.followUpsDue, input.followUpNumber);
    return Promise.resolve({ messageId });
  }
  loadMessageApproval(messageId: string): Promise<string | null> {
    return Promise.resolve(this.approvals.get(messageId) ?? null);
  }
  loadThread(contactId: string) {
    return Promise.resolve(this.threads.get(contactId) ?? null);
  }
}
