import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import * as s from '../../../../db/schema';
import { inngestSendEvents } from '../../../../lib/workflows/events';
import type { InboundDeps, Owner } from './inbound';

/** Lazy: nothing touches the database or credentials until a request arrives (keeps `next build` credential-free). */
export function postgresInboundDeps(provider: 'agentmail' | 'agentcall', env: NodeJS.ProcessEnv = process.env): InboundDeps {
  const db = () => getDb();
  const ownerOf = async (contactId: string): Promise<Owner | undefined> => {
    const [c] = await db().select({ id: s.contacts.id, caseId: s.contacts.caseId }).from(s.contacts).where(eq(s.contacts.id, contactId));
    return c ? { contactId: c.id, caseId: c.caseId } : undefined;
  };
  return {
    secret: provider === 'agentmail' ? env.AGENTMAIL_WEBHOOK_SECRET : env.AGENTCALL_WEBHOOK_SECRET,
    async lookupThread(threadId) {
      const [row] = await db().select({ contactId: s.messages.contactId }).from(s.messages)
        .where(and(eq(s.messages.providerThreadId, threadId), eq(s.messages.direction, 'outbound'))).limit(1);
      return row ? ownerOf(row.contactId) : undefined;
    },
    async lookupCall(callId) {
      const [row] = await db().select({ contactId: s.calls.contactId }).from(s.calls).where(eq(s.calls.providerCallId, callId)).limit(1);
      return row ? ownerOf(row.contactId) : undefined;
    },
    async storeInboundMessage(m) {
      const [existing] = await db().select({ id: s.messages.id }).from(s.messages)
        .where(eq(s.messages.providerMessageId, m.providerMessageId)).limit(1);
      if (existing) return 'duplicate';
      await db().insert(s.messages).values({
        contactId: m.contactId, direction: 'inbound', channel: 'email',
        providerThreadId: m.providerThreadId, providerMessageId: m.providerMessageId,
        ...(m.subject !== undefined ? { subject: m.subject } : {}), body: m.body,
        sharedFields: [], receivedAt: m.receivedAt, ...(m.classification !== undefined ? { classification: m.classification } : {}),
      });
      await db().update(s.contacts).set({ lastActivityAt: m.receivedAt }).where(eq(s.contacts.id, m.contactId));
      return 'stored';
    },
    async storeCallEvent(e) {
      await db().update(s.calls).set({
        ...(e.transcript !== undefined ? { transcript: e.transcript } : {}),
        ...(e.endedAt !== undefined ? { endedAt: e.endedAt } : {}),
        ...(e.status !== undefined ? { outcome: e.status } : {}),
      }).where(and(eq(s.calls.providerCallId, e.providerCallId), eq(s.calls.contactId, e.contactId)));
    },
    sendEvents: (events) => inngestSendEvents()(events),
  };
}
