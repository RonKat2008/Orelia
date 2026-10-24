import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import * as s from '../../../../db/schema';
import { createRuntimeClassifier, FixtureClassifier } from '../../../../lib/inbox/classifier';
import { PostgresTaskStore } from '../../../../lib/inbox/task-store';
import { DbRunStore } from '../../../../lib/agents/run-store';
import type { DraftContext } from '../../../../lib/inbox/drafts';
import { isOffline } from '../../../../lib/env';
import { createWebhookIngest, idempotentIngest } from './ingest';
import { workflowSendEvents } from '../../../../lib/workflows/inline-events';
import type { IngestLedger, InboundDeps, Owner } from './inbound';

/** Postgres unique_violation, including when the driver nests it on `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    if ((cur as { code?: unknown }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Draft context for a contact: resource name, consented fields and the patient fields the consent covers. */
export async function loadDraftContext(contactId: string): Promise<DraftContext> {
  const db = getDb();
  const [c] = await db.select().from(s.contacts).where(eq(s.contacts.id, contactId));
  if (!c) throw new Error('Contact not found');
  const [consent] = await db.select().from(s.consents).where(eq(s.consents.contactId, contactId));
  const [caseRow] = await db.select().from(s.cases).where(eq(s.cases.id, c.caseId));
  const name = async (): Promise<{ name?: string; address?: string }> => {
    if (c.targetKind === 'institution') {
      const [r] = await db.select().from(s.institutions).where(eq(s.institutions.id, c.targetId));
      return { name: r?.name, address: [r?.city, r?.state].filter(Boolean).join(', ') || undefined };
    }
    if (c.targetKind === 'expert') {
      const [r] = await db.select().from(s.experts).where(eq(s.experts.id, c.targetId));
      return { name: r?.name };
    }
    if (c.targetKind === 'organization') {
      const [r] = await db.select().from(s.organizations).where(eq(s.organizations.id, c.targetId));
      return { name: r?.name };
    }
    return {};
  };
  const target = await name();
  const { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals } = caseRow ?? {};
  return {
    contactId, caseId: c.caseId, resourceName: target.name ?? c.address,
    ...(target.address ? { resourceAddress: target.address } : {}),
    consent: { sharedFields: consent?.sharedFields ?? [] },
    caseRecord: { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals },
  };
}

/** A claim older than this is treated as abandoned (the request died mid-ingest) and may be taken over. */
export const INGEST_LEASE_MS = 5 * 60_000;

/**
 * Ingest ledger over messages.ingested_at / ingest_claimed_at and calls.transcript_ingested_at / _claimed_at.
 * claim is a single conditional UPDATE, so two concurrent deliveries cannot both win.
 */
export function postgresIngestLedger(db: () => ReturnType<typeof getDb> = getDb): IngestLedger {
  const staleBefore = () => new Date(Date.now() - INGEST_LEASE_MS);
  return {
    async claim(k) {
      if (k.kind === 'email') {
        const m = s.messages;
        const match = and(eq(m.providerMessageId, k.providerMessageId), eq(m.direction, 'inbound'));
        const won = await db().update(m).set({ ingestClaimedAt: sql`now()` })
          .where(and(match, isNull(m.ingestedAt), or(isNull(m.ingestClaimedAt), lt(m.ingestClaimedAt, staleBefore()))))
          .returning({ id: m.id });
        if (won.length) return 'claimed';
        const [row] = await db().select({ ingestedAt: m.ingestedAt }).from(m).where(match).limit(1);
        if (!row) throw new Error('Inbound message row missing for ingest claim');
        return row.ingestedAt ? 'done' : 'busy';
      }
      const c = s.calls;
      const match = and(eq(c.providerCallId, k.providerCallId), eq(c.contactId, k.contactId));
      const won = await db().update(c).set({ transcriptIngestClaimedAt: sql`now()` })
        .where(and(match, isNull(c.transcriptIngestedAt), or(isNull(c.transcriptIngestClaimedAt), lt(c.transcriptIngestClaimedAt, staleBefore()))))
        .returning({ id: c.id });
      if (won.length) return 'claimed';
      const [row] = await db().select({ ingestedAt: c.transcriptIngestedAt }).from(c).where(match).limit(1);
      if (!row) throw new Error('Call row missing for ingest claim');
      return row.ingestedAt ? 'done' : 'busy';
    },
    async complete(k) {
      if (k.kind === 'email') {
        await db().update(s.messages).set({ ingestedAt: sql`now()`, ingestClaimedAt: null })
          .where(and(eq(s.messages.providerMessageId, k.providerMessageId), eq(s.messages.direction, 'inbound')));
        return;
      }
      await db().update(s.calls).set({ transcriptIngestedAt: sql`now()`, transcriptIngestClaimedAt: null })
        .where(and(eq(s.calls.providerCallId, k.providerCallId), eq(s.calls.contactId, k.contactId)));
    },
    async release(k) {
      if (k.kind === 'email') {
        await db().update(s.messages).set({ ingestClaimedAt: null })
          .where(and(eq(s.messages.providerMessageId, k.providerMessageId), eq(s.messages.direction, 'inbound'), isNull(s.messages.ingestedAt)));
        return;
      }
      await db().update(s.calls).set({ transcriptIngestClaimedAt: null })
        .where(and(eq(s.calls.providerCallId, k.providerCallId), eq(s.calls.contactId, k.contactId), isNull(s.calls.transcriptIngestedAt)));
    },
  };
}

/** Verification calls: matched by provider call id in verification_requests, ingested by VerificationService. */
function verificationInboundDeps(): InboundDeps['verification'] {
  const service = async () => (await import('../../../../lib/verification/server')).getVerificationService();
  return {
    async isVerificationCall(callId) {
      const { getVerificationStore } = await import('../../../../lib/verification/store');
      return (await getVerificationStore().byCallId(callId)) !== null;
    },
    ingest: async (callId, transcript, receivedAt) => (await service()).ingest(callId, transcript, receivedAt),
    status: async (callId, status) => (await service()).callStatus(callId, status),
    hasPendingCall: async () => (await service()).hasPendingCall(),
  };
}

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
      if (existing) return { status: 'duplicate', id: existing.id };
      let id: string;
      try {
        const [row] = await db().insert(s.messages).values({
          contactId: m.contactId, direction: 'inbound', channel: 'email',
          providerThreadId: m.providerThreadId, providerMessageId: m.providerMessageId,
          ...(m.subject !== undefined ? { subject: m.subject } : {}), body: m.body,
          sharedFields: [], receivedAt: m.receivedAt, ...(m.classification !== undefined ? { classification: m.classification } : {}),
        }).returning({ id: s.messages.id });
        id = row!.id;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Lost a race with a concurrent delivery: the other request's row is the stored message.
        const [raced] = await db().select({ id: s.messages.id }).from(s.messages)
          .where(eq(s.messages.providerMessageId, m.providerMessageId)).limit(1);
        if (!raced) throw err;
        return { status: 'duplicate', id: raced.id };
      }
      await db().update(s.contacts).set({ lastActivityAt: m.receivedAt }).where(eq(s.contacts.id, m.contactId));
      return { status: 'stored', id };
    },
    async storeCallEvent(e) {
      await db().update(s.calls).set({
        ...(e.transcript !== undefined ? { transcript: e.transcript } : {}),
        ...(e.endedAt !== undefined ? { endedAt: e.endedAt } : {}),
        ...(e.status !== undefined ? { outcome: e.status } : {}),
      }).where(and(eq(s.calls.providerCallId, e.providerCallId), eq(s.calls.contactId, e.contactId)));
    },
    sendEvents: (events) => workflowSendEvents(env)(events),
    ingestLedger: postgresIngestLedger(db),
    ...(provider === 'agentcall' ? { verification: verificationInboundDeps() } : {}),
    ingestInbound: (event) => {
      const tasks = new PostgresTaskStore();
      const ingest = createWebhookIngest({
        inbox: {
          classifier: isOffline(env.WAYFINDER_OFFLINE) ? new FixtureClassifier() : createRuntimeClassifier({ store: new DbRunStore() }),
          loadContext: contactId => loadDraftContext(contactId),
          tasks,
        },
      });
      return idempotentIngest(tasks, (e, sourceId) => ingest({ ...e, sourceId }))(event);
    },
  };
}
