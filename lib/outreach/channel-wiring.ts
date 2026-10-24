import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { AgentCallChannel } from '../channels/agentcall';
import { AgentMailChannel } from '../channels/agentmail';
import { MockCaller } from '../channels/mock-caller';
import { MockMailer } from '../channels/mock-mailer';
import { defaultMockPages, MockBrowserProvider } from '../channels/mock-browser';
import { KernelBrowserProvider } from '../channels/kernel-web';
import { WebFormChannel, type LoadUpload } from '../channels/web-form';
import type { BrowserProvider } from '../channels/browser-types';
import { DemoCallSimulator, completeSimulatedCall, type SimulatedCallIngest } from './demo-call';
import { demoDestinationsEnabled, outboundAllowlist, webAllowlist } from './demo-destinations';
import { isDefiniteNonDelivery, type ChannelGuardOptions, type ProviderName } from '../channels/types';
import { parseAllowlist } from '../safety/allowlist';
import { FOLLOW_UP_BUSINESS_DAYS } from '../safety/caps';
import { checkOutbound } from '../safety/outbound-gate';
import { parseTimeScale } from '../workflows/clock';
import { contactApprovedEvent, followUpApprovedEvent, type SendEvents } from '../workflows/events';
import { OutreachService } from './service';
import { OutreachError, type Channel, type OutreachStore, type ProviderRef } from './types';

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Channel selection
// ---------------------------------------------------------------------------

/** The same allowlist/mode the gate uses, handed to adapters as their second lock (hard rule 4). */
export function guardFromEnv(env: Env): ChannelGuardOptions {
  return {
    allowlist: parseAllowlist(env.OUTBOUND_ALLOWLIST ?? ''),
    mode: env.NODE_ENV === 'production' ? 'prod' : 'dev',
    outboundAllowReal: env.OUTBOUND_ALLOW_REAL,
    // Demo mode adds only this deployment's own host (the demo intake form); see demo-destinations.ts.
    webAllowlist: webAllowlist(env),
  };
}

export interface SelectedChannels {
  channels: [Channel, Channel];
  providers: { email: Extract<ProviderName, 'agentmail' | 'mock-mailer'>; voice: Extract<ProviderName, 'agentcall' | 'mock-caller'> };
}

const isOffline = (env: Env) => ['1', 'true'].includes((env.WAYFINDER_OFFLINE ?? '').trim().toLowerCase());
const loggedChoices = new Set<string>();

/**
 * Offline mode (WAYFINDER_OFFLINE=1|true) or missing keys => mocks. Email is real only with
 * AGENTMAIL_API_KEY; voice only with AGENTCALL_API_KEY AND AGENTCALL_FROM_NUMBER_ID. Constructing a
 * real channel never touches the network. Only the provider names are logged, never keys.
 */
export function selectChannels(env: Env = process.env, deps: { now?: () => Date; fetcher?: typeof fetch } = {}): SelectedChannels {
  const guard = guardFromEnv(env);
  const offline = isOffline(env);
  const mailKey = env.AGENTMAIL_API_KEY?.trim();
  const callKey = env.AGENTCALL_API_KEY?.trim();
  const fromNumberId = env.AGENTCALL_FROM_NUMBER_ID?.trim();
  const email = !offline && mailKey
    ? new AgentMailChannel({ apiKey: mailKey, guard, ...(env.AGENTMAIL_SENDER_INBOX_ID?.trim() ? { senderInboxId: env.AGENTMAIL_SENDER_INBOX_ID.trim() } : {}), ...(deps.now ? { now: deps.now } : {}), ...(deps.fetcher ? { fetcher: deps.fetcher } : {}) })
    : new MockMailer(guard, deps.now);
  const caller = !offline && callKey && fromNumberId
    ? new AgentCallChannel({ apiKey: callKey, fromNumberId, guard, ...(deps.fetcher ? { fetcher: deps.fetcher } : {}) })
    : new MockCaller(guard, deps.now);
  // Demo mode: calls to the reserved demo sink are simulated in front of the caller (which would refuse the sink).
  const voice: Channel = demoDestinationsEnabled(env) ? new DemoCallSimulator(caller) : caller;
  const providers = {
    email: email instanceof AgentMailChannel ? 'agentmail' as const : 'mock-mailer' as const,
    voice: caller instanceof AgentCallChannel ? 'agentcall' as const : 'mock-caller' as const,
  };
  const key = `${providers.email}/${providers.voice}`;
  if (!loggedChoices.has(key)) { loggedChoices.add(key); console.info(`[outreach] channels: email=${providers.email} voice=${providers.voice}`); }
  return { channels: [email, voice], providers };
}

/**
 * Web-form channel: offline => MockBrowserProvider with the demo pages; otherwise Kernel, which reports
 * status 'unconfigured' (and never touches the network) when KERNEL_API_KEY is absent.
 */
export function selectWebChannel(env: Env = process.env, deps: { loadUpload?: LoadUpload; provider?: BrowserProvider } = {}): WebFormChannel {
  const guard = guardFromEnv(env);
  const apiKey = env.KERNEL_API_KEY?.trim();
  const provider = deps.provider ?? (isOffline(env) ? new MockBrowserProvider(defaultMockPages) : new KernelBrowserProvider(apiKey ? { apiKey } : {}));
  return new WebFormChannel({ provider, guard, ...(deps.loadUpload ? { loadUpload: deps.loadUpload } : {}) });
}

// ---------------------------------------------------------------------------
// Follow-up persistence (small interfaces so tests need no Postgres)
// ---------------------------------------------------------------------------

export interface FollowUpDraft {
  messageId: string;
  contactId: string;
  caseId: string;
  classification: string | null;
  approvedAt?: string | null;
  sentAt?: string | null;
}
/** Everything the sender needs about the outbound follow-up message row. */
export interface FollowUpMessage extends FollowUpDraft {
  direction: string;
  channel: 'email' | 'voice';
  subject?: string;
  body: string;
}
export interface FollowUpDraftReader {
  /** Outbound message by id for a contact (any classification; the caller decides if it is a follow-up). */
  get(draftId: string, contactId: string): Promise<FollowUpDraft | undefined>;
  /** Set contacts.first_sent_at once (only where still NULL): the cadence anchor. */
  markFirstSent(contactId: string, sentAt: string): Promise<void>;
  /**
   * Records the patient's approval of a follow-up: approved_at NULL -> at, only while unsent (compare-and-set).
   * False when it was already approved or sent, or is not a follow-up of this contact.
   */
  approveFollowUp(draftId: string, contactId: string, at: string): Promise<boolean>;
  /** Undo approveFollowUp when nothing was sent (gate refusal, not sendable). Never touches a sent row. */
  withdrawFollowUpApproval(draftId: string, contactId: string): Promise<void>;
}
export interface FollowUpStore {
  getMessage(messageId: string): Promise<FollowUpMessage | undefined>;
  /**
   * Atomic send claim: true only for the single caller that flips sent_at NULL -> at on an APPROVED row
   * (approved_at is the human authorization and is never written here).
   */
  reserve(messageId: string, contactId: string, at: string): Promise<boolean>;
  /** Undo a send claim after a gate refusal (nothing was sent): sent_at back to NULL. approved_at is kept. */
  release(messageId: string, contactId: string): Promise<void>;
  delivered(messageId: string, contactId: string, ref: ProviderRef, sentAt: string): Promise<void>;
}

export const isFollowUpClassification = (c: string | null | undefined): c is string => !!c && c.startsWith('follow_up_');

const iso = (v: unknown): string | null => v == null ? null : new Date(v as string | Date).toISOString();

export class PostgresFollowUpStore implements FollowUpDraftReader, FollowUpStore {
  private get db() { return getDb(); }
  private async rows(query: ReturnType<typeof sql>) { return (await this.db.execute(query)).rows as Record<string, unknown>[]; }
  private async row(messageId: string, contactId?: string): Promise<FollowUpMessage | undefined> {
    const [r] = await this.rows(sql`
      SELECT m.id, m.contact_id, c.case_id, m.classification, m.approved_at, m.sent_at, m.direction, m.channel, m.subject, m.body
      FROM messages m JOIN contacts c ON c.id = m.contact_id
      WHERE m.id = ${messageId}::uuid AND m.direction = 'outbound' ${contactId ? sql`AND m.contact_id = ${contactId}::uuid` : sql``}`);
    if (!r) return undefined;
    return {
      messageId: String(r.id), contactId: String(r.contact_id), caseId: String(r.case_id), classification: (r.classification as string | null) ?? null,
      approvedAt: iso(r.approved_at), sentAt: iso(r.sent_at), direction: String(r.direction), channel: r.channel as 'email' | 'voice',
      ...(r.subject ? { subject: String(r.subject) } : {}), body: String(r.body),
    };
  }
  async get(draftId: string, contactId: string) { return this.row(draftId, contactId); }
  getMessage(messageId: string) { return this.row(messageId); }
  async markFirstSent(contactId: string, sentAt: string) {
    await this.db.execute(sql`UPDATE contacts SET first_sent_at = ${sentAt}::timestamptz WHERE id = ${contactId}::uuid AND first_sent_at IS NULL`);
  }
  async approveFollowUp(draftId: string, contactId: string, at: string) {
    const rows = await this.rows(sql`
      UPDATE messages SET approved_at = ${at}::timestamptz
      WHERE id = ${draftId}::uuid AND contact_id = ${contactId}::uuid AND direction = 'outbound'
        AND classification LIKE 'follow_up_%' AND approved_at IS NULL AND sent_at IS NULL
      RETURNING id`);
    return rows.length === 1;
  }
  async withdrawFollowUpApproval(draftId: string, contactId: string) {
    await this.db.execute(sql`UPDATE messages SET approved_at = NULL WHERE id = ${draftId}::uuid AND contact_id = ${contactId}::uuid AND classification LIKE 'follow_up_%' AND sent_at IS NULL`);
  }
  async reserve(messageId: string, contactId: string, at: string) {
    const rows = await this.rows(sql`
      UPDATE messages SET sent_at = ${at}::timestamptz
      WHERE id = ${messageId}::uuid AND contact_id = ${contactId}::uuid AND approved_at IS NOT NULL AND sent_at IS NULL
      RETURNING id`);
    return rows.length === 1;
  }
  async release(messageId: string, contactId: string) {
    await this.db.execute(sql`UPDATE messages SET sent_at = NULL WHERE id = ${messageId}::uuid AND contact_id = ${contactId}::uuid AND provider_message_id IS NULL`);
  }
  async delivered(messageId: string, contactId: string, ref: ProviderRef, sentAt: string) {
    await this.db.batch([
      this.db.execute(sql`UPDATE messages SET sent_at = ${sentAt}::timestamptz, provider_message_id = ${ref.messageId ?? null}, provider_thread_id = COALESCE(${ref.threadId ?? null}, provider_thread_id) WHERE id = ${messageId}::uuid`),
      // follow_ups_sent is advanced by the follow-up workflow (APPROVED_SENT transition, saved by
      // PostgresContactContextStore); incrementing it here too would count the send twice.
      this.db.execute(sql`UPDATE contacts SET last_activity_at = ${sentAt}::timestamptz WHERE id = ${contactId}::uuid`),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Approve route wiring
// ---------------------------------------------------------------------------

type BaseApproveResult = Awaited<ReturnType<OutreachService['approve']>>;
/**
 * `workflow: 'pending'` = sent, but stamping/emitting the workflow event failed. A follow-up returns sentAt once it
 * went out, and { queued: true } only when a durable engine (Inngest) accepted it for sending (see approve()).
 */
export type WiredApproveResult = BaseApproveResult & { workflow?: 'pending' };

/**
 * Codex's OutreachService plus the workflow hand-off.
 *
 * - First message: super.approve() runs checkOutbound -> reserve -> channel.send -> delivered. Afterwards we
 *   stamp contacts.first_sent_at (cadence anchor) and emit contact/approved.
 *   If the email already went out but stamping or emitting fails, we MUST NOT report a send failure (the user
 *   would retry and the 409 would hide the truth). We log and return the result with `workflow: 'pending'` so
 *   an operator/retry job can re-emit the (idempotent, id contact-approved-<draftId>) event.
 * - Follow-ups: the human approval is recorded on the row (approved_at, compare-and-set), then follow-up/approved
 *   is emitted; the follow-up workflow re-reads approved_at and sends via createFollowUpSender (which re-runs the
 *   gate). Inline (no Inngest) that happens inside this request, so the result says whether it was sent; if it was
 *   refused or is not sendable, the approval is withdrawn and the error is returned. Only a durable engine yields
 *   { queued: true }.
 */
export class WiredOutreachService extends OutreachService {
  constructor(
    store: OutreachStore,
    channels: Channel[],
    private readonly sendEvents: SendEvents,
    env: Env = process.env,
    clock: () => Date = () => new Date(),
    private readonly followUps: FollowUpDraftReader,
    /** DEMO ONLY: ingests the scripted transcript of a simulated demo call (see demo-call.ts). */
    private readonly simulatedCallIngest?: SimulatedCallIngest,
  ) { super(store, channels, env, clock); }

  override async approve(id: string, draftId: string): Promise<WiredApproveResult> {
    const followUp = await this.followUps.get(draftId, id);
    if (followUp && isFollowUpClassification(followUp.classification)) return this.approveFollowUp(id, draftId, followUp.caseId);
    const result = await super.approve(id, draftId);
    if ('queued' in result) return result;
    const contact = await this.requireContact(id);
    try {
      await this.followUps.markFirstSent(id, result.sentAt);
      await this.sendEvents(contactApprovedEvent({ contactId: id, caseId: contact.caseId, messageId: draftId, approvedAt: result.approvedAt }));
    } catch (error) {
      console.error('Post-send workflow hand-off failed (email was sent):', error instanceof Error ? error.name : 'unknown');
      return { ...result, workflow: 'pending' };
    }
    // DEMO ONLY: a simulated call has no provider webhook; its scripted transcript is ingested now, after the
    // contact/approved hand-off, so the reply -> task flow runs in the usual order. Never fails the approval.
    if (this.simulatedCallIngest && result.provider.callId) {
      await completeSimulatedCall(this.simulatedCallIngest, { contactId: id, caseId: contact.caseId, callId: result.provider.callId, at: result.sentAt });
    }
    return result;
  }

  private async approveFollowUp(id: string, draftId: string, caseId: string): Promise<WiredApproveResult> {
    const approvedAt = this.clock().toISOString();
    if (!await this.followUps.approveFollowUp(draftId, id, approvedAt)) throw new OutreachError(409, ['already_approved']);
    try {
      await this.sendEvents(followUpApprovedEvent({ contactId: id, caseId, messageId: draftId, approvedAt }));
    } catch (error) {
      // Nothing was sent (a send that went out sets sent_at, which withdraw never touches).
      await this.followUps.withdrawFollowUpApproval(draftId, id);
      throw error;
    }
    const after = await this.followUps.get(draftId, id);
    if (after?.sentAt) return { draftId, approvedAt, sentAt: after.sentAt, provider: {} };
    // Accepted by a durable engine: it will send (or refuse) later. A queued approval has no sent timestamp.
    if (this.sendEvents.durable) return { draftId, approvedAt, queued: true };
    // Inline and still unsent: nothing will happen later, so do not leave it approved or say it was queued.
    await this.followUps.withdrawFollowUpApproval(draftId, id);
    throw new OutreachError(409, ['follow_up_not_sent']);
  }
}

// ---------------------------------------------------------------------------
// Follow-up sender: the ONLY path by which the workflow can send
// ---------------------------------------------------------------------------

export class DuplicateSendError extends Error {
  constructor(readonly messageId: string) { super(`message ${messageId} was already approved or sent; refusing to send twice`); this.name = 'DuplicateSendError'; }
}
export class FollowUpRefusedError extends Error {
  constructor(readonly reasons: string[]) { super(`follow-up refused: ${reasons.join(', ')}`); this.name = 'FollowUpRefusedError'; }
}

export interface FollowUpSenderOptions {
  env?: Env;
  store?: OutreachStore;
  channels?: Channel[];
  clock?: () => Date;
  /** Persistence for follow-up message rows; defaults to Postgres. */
  db?: FollowUpStore;
}
export interface FollowUpSendInput { contactId: string; caseId: string; messageId: string; kind: 'initial' | 'follow_up' }

/**
 * Simulated demo time -- the ONLY cadence relaxation in the system. With WAYFINDER_SIM_TIME_SCALE > 1 (and
 * never in prod) the gate is shown now' = firstSentAt + (realNow - firstSentAt) * scale, so a demo can show
 * "business day 3" about a real minute after the first send (scale 1440 = one simulated day per minute).
 * The gate itself, allowlist, consent, caps and approval are untouched; production ignores the variable.
 */
function gateNow(realNow: Date, firstSentAt: Date, scale: number, mode: 'dev' | 'prod'): Date {
  if (mode === 'prod' || scale <= 1) return realNow;
  return new Date(firstSentAt.getTime() + (realNow.getTime() - firstSentAt.getTime()) * scale);
}

export function createFollowUpSender(opts: FollowUpSenderOptions = {}) {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? (() => new Date());
  let store = opts.store; let channels = opts.channels; let db = opts.db;
  const lazy = async () => {
    if (!store) { const { PostgresOutreachStore } = await import('./postgres-store'); store = new PostgresOutreachStore(); }
    channels ??= selectChannels(env).channels;
    db ??= new PostgresFollowUpStore();
    return { store, channels, db };
  };
  return async function sendFollowUp(input: FollowUpSendInput): Promise<{ providerRef: string }> {
    if (input.kind !== 'follow_up') throw new Error('initial messages are sent only through the approve route');
    const { store, channels, db } = await lazy();
    const message = await db.getMessage(input.messageId);
    if (!message || message.direction !== 'outbound' || message.contactId !== input.contactId || !isFollowUpClassification(message.classification)) {
      throw new FollowUpRefusedError(['not_a_follow_up_for_contact']);
    }
    if (message.sentAt) throw new DuplicateSendError(input.messageId); // fast path; reserve() below is the atomic guard
    // approved_at is the patient's approval (the approve route or a walk-away pre-approval). Never send without it.
    const persistedApproval = message.approvedAt ? new Date(message.approvedAt) : null;
    if (!persistedApproval || Number.isNaN(persistedApproval.getTime())) throw new FollowUpRefusedError(['not_approved']);
    const contact = await store.contact(input.contactId);
    if (!contact || contact.caseId !== input.caseId || message.caseId !== input.caseId) throw new FollowUpRefusedError(['contact_not_found']);
    if (message.channel !== contact.channel) throw new FollowUpRefusedError(['channel_mismatch']);
    const channel = channels.find(c => c.kind === contact.channel);
    if (!channel) throw new FollowUpRefusedError(['channel_unavailable']);
    const consent = await store.consent(input.contactId);
    const caseRecord = await store.getCase(input.caseId);
    if (!consent?.approvedAt || !caseRecord) throw new FollowUpRefusedError([consent?.approvedAt ? 'case_not_found' : 'consent_required']);
    const all = await store.contacts(input.caseId);
    const withAnchor = all.map(c => {
      const firstSentAt = (c as { firstSentAt?: string | Date | null }).firstSentAt ?? c.lastSentAt ?? null;
      return { ...c, lastSentAt: firstSentAt, followUpsSent: c.followUpsSent ?? 0 };
    });
    const target = withAnchor.find(c => c.id === input.contactId);
    // follow_up_1 is only valid as the first follow-up, follow_up_2 as the second.
    const ordinal = Number(message.classification.slice('follow_up_'.length));
    if (!target || ordinal !== (target.followUpsSent ?? 0) + 1 || ordinal > FOLLOW_UP_BUSINESS_DAYS.length) throw new FollowUpRefusedError(['follow_up_out_of_order']);

    const realNow = clock();
    const mode = env.NODE_ENV === 'production' ? 'prod' : 'dev';
    const now = target.lastSentAt ? gateNow(realNow, new Date(target.lastSentAt), parseTimeScale(env.WAYFINDER_SIM_TIME_SCALE), mode) : realNow;
    const approvedAt = persistedApproval.toISOString();

    // Atomic send claim by message id (sent_at): exactly one caller proceeds; a retry or concurrent run throws.
    if (!await db.reserve(input.messageId, input.contactId, realNow.toISOString())) throw new DuplicateSendError(input.messageId);
    const gate = checkOutbound({
      draft: { channel: contact.channel, address: contact.address, body: message.body, ...(message.subject ? { subject: message.subject } : {}), contactId: contact.id, caseId: input.caseId, approvedAt, isFollowUp: true },
      consent, caseRecord, contacts: withAnchor, allowlist: outboundAllowlist(env), now: now.toISOString(), mode,
      outboundAllowReal: env.OUTBOUND_ALLOW_REAL,
    });
    if (!gate.ok) {
      await db.release(input.messageId, input.contactId); // nothing was sent
      throw new FollowUpRefusedError([...gate.reasons]);
    }
    // If send throws we leave the sent_at claim set: an ambiguous send must not auto-retry (same policy as Codex's reserve).
    let ref: ProviderRef;
    try { ref = await channel.send(gate.payload); } catch (error) {
      if (isDefiniteNonDelivery(error)) await db.release(input.messageId, input.contactId); // provider 4xx: nothing was sent
      throw error;
    }
    await db.delivered(input.messageId, input.contactId, ref, realNow.toISOString());
    return { providerRef: ref.messageId ?? ref.callId ?? input.messageId };
  };
}
