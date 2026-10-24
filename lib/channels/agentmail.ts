import { createHmac, timingSafeEqual } from 'node:crypto';
import { AgentMailClient } from 'agentmail';
import { assertGated, ChannelError, type Channel, type ChannelGuardOptions, type GatedDraft, type KnownThreadLookup, type OutboundThreadRef, type ProviderInbound, type ProviderRef } from './types';

const PROVIDER = 'agentmail' as const;
const TOLERANCE_SECONDS = 300;
const NO_RETRY = { maxRetries: 0 } as const; // a retried send could duplicate an email; callers retry on ChannelError.retryable

export interface AgentMailChannelOptions {
  apiKey?: string;
  client?: AgentMailClient;
  fetcher?: typeof fetch;
  guard: ChannelGuardOptions;
  inboxDomain?: string;
  /**
   * Send every case from this one existing inbox (AGENTMAIL_SENDER_INBOX_ID) instead of creating one inbox per case.
   * For plans with an inbox cap (the free plan allows 3). Replies still route by provider thread id.
   */
  senderInboxId?: string;
  now?: () => Date;
}

export interface CaseInbox { readonly inboxId: string; readonly email: string }
export interface ThreadMessage { readonly messageId: string; readonly from: string; readonly to: readonly string[]; readonly subject?: string; readonly text?: string; readonly timestamp: string }

/** Email via AgentMail: one inbox per case, text-only sends, replies kept in the same thread. */
export class AgentMailChannel implements Channel {
  readonly kind = 'email' as const;
  private client: AgentMailClient;
  private inboxes = new Map<string, CaseInbox>();
  private apiKey?: string;
  constructor(private opts: AgentMailChannelOptions) {
    if (opts.client) this.client = opts.client;
    else if (opts.apiKey) {
      this.apiKey = opts.apiKey;
      this.client = new AgentMailClient({ apiKey: opts.apiKey, ...(opts.fetcher ? { fetch: opts.fetcher } : {}) });
    } else throw new ChannelError(PROVIDER, 'apiKey or client is required');
  }

  /** Idempotent: the same clientId makes AgentMail return the existing inbox. */
  async createCaseInbox(caseId: string): Promise<CaseInbox> {
    const cached = this.inboxes.get(caseId);
    if (cached) return cached;
    if (this.opts.senderInboxId) return { inboxId: this.opts.senderInboxId, email: this.opts.senderInboxId };
    try {
      const inbox = await this.client.inboxes.create({
        clientId: `wayfinder-case-${caseId}`, displayName: 'Wayfinder', metadata: { caseId },
        ...(this.opts.inboxDomain ? { domain: this.opts.inboxDomain } : {}),
      }, NO_RETRY);
      const made = { inboxId: inbox.inboxId, email: inbox.email };
      this.inboxes.set(caseId, made);
      return made;
    } catch (err) { throw this.mapError(err); }
  }

  async send(gated: GatedDraft, thread?: OutboundThreadRef): Promise<ProviderRef> {
    const to = assertGated(gated, 'email', PROVIDER, this.opts.guard);
    const caseId = this.requireCase(gated);
    if (thread?.messageId) {
      const inboxId = thread.inboxId ?? (await this.createCaseInbox(caseId)).inboxId;
      return this.reply(to, gated, caseId, inboxId, thread.messageId);
    }
    const { inboxId } = await this.createCaseInbox(caseId);
    try {
      const res = await this.client.inboxes.messages.send(inboxId, {
        to, text: gated.body, labels: this.labels(gated, caseId),
        ...(gated.subject !== undefined ? { subject: gated.subject } : {}),
      }, NO_RETRY);
      return this.ref(inboxId, res.threadId, res.messageId);
    } catch (err) { throw this.mapError(err); }
  }

  /** Follow-up inside an existing thread; messageId is the last provider message to reply to. */
  async sendInThread(gated: GatedDraft, ctx: { inboxId: string; messageId: string }): Promise<ProviderRef> {
    return this.send(gated, ctx);
  }

  private async reply(to: string, gated: GatedDraft, caseId: string, inboxId: string, messageId: string): Promise<ProviderRef> {
    try {
      const res = await this.client.inboxes.messages.reply(inboxId, messageId, {
        to: [to], text: gated.body, labels: this.labels(gated, caseId),
      }, NO_RETRY);
      return this.ref(inboxId, res.threadId, res.messageId);
    } catch (err) { throw this.mapError(err); }
  }

  async listThreadMessages(threadId: string, isKnownThread: KnownThreadLookup): Promise<ThreadMessage[]> {
    if (!(await isKnownThread(threadId))) throw new ChannelError(PROVIDER, 'not a Wayfinder thread', 404);
    try {
      const thread = await this.client.threads.get(threadId, undefined, NO_RETRY);
      return thread.messages.map(m => ({
        messageId: m.messageId, from: m.from, to: m.to, timestamp: m.timestamp.toISOString(),
        ...(m.subject !== undefined ? { subject: m.subject } : {}), ...(m.text !== undefined ? { text: m.text } : {}),
      }));
    } catch (err) { throw this.mapError(err); }
  }

  private requireCase(gated: GatedDraft): string {
    if (!gated.caseId) throw new ChannelError(PROVIDER, 'Refusing email without a caseId (needs a per-case inbox)');
    return gated.caseId;
  }
  private labels(gated: GatedDraft, caseId: string): string[] {
    return ['wayfinder', `case:${caseId}`, ...(gated.contactId ? [`contact:${gated.contactId}`] : [])];
  }
  private ref(inboxId: string, threadId: string, messageId: string): ProviderRef {
    return { provider: PROVIDER, channel: 'email', inboxId, threadId, messageId, status: 'sent' };
  }

  private mapError(err: unknown): ChannelError {
    if (err instanceof ChannelError) return err;
    const status = (err as { statusCode?: number } | null)?.statusCode;
    const body = (err as { body?: unknown } | null)?.body;
    const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const detail = typeof b.message === 'string' ? b.message : status ? `HTTP ${status}` : 'request failed';
    const safe = this.apiKey ? detail.split(this.apiKey).join('[redacted]') : detail;
    const code = typeof b.code === 'string' || typeof b.code === 'number' ? b.code : typeof b.name === 'string' ? b.name : undefined;
    // No status means the request never completed (network/timeout), which is worth retrying.
    const retryable = status === undefined || status === 429 || status >= 500;
    return new ChannelError(PROVIDER, safe, status, retryable, { ...(code !== undefined ? { code } : {}), ...(typeof b.name === 'string' ? { name: b.name } : {}) });
  }
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;
function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/** Standard Svix scheme: HMAC-SHA256(base64-decoded secret, `${id}.${timestamp}.${body}`), base64, `v1,<sig>` entries. */
export function verifyAgentMailSignature(rawBody: string, headers: HeaderBag, secret: string, nowSeconds = Date.now() / 1000): boolean {
  const id = header(headers, 'svix-id'), ts = header(headers, 'svix-timestamp'), sigs = header(headers, 'svix-signature');
  if (!id || !ts || !sigs || !secret || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowSeconds - Number(ts)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
  let ok = false;
  for (const entry of sigs.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) ok = true; // keep scanning rather than early-exit
  }
  return ok;
}

export async function parseAgentMailWebhook(
  rawBody: string, headers: HeaderBag, secret: string, isKnownThread: KnownThreadLookup, now: () => Date = () => new Date(),
): Promise<ProviderInbound & { contactId: string }> {
  if (!verifyAgentMailSignature(rawBody, headers, secret, now().getTime() / 1000)) throw new ChannelError(PROVIDER, 'invalid webhook signature', 401);
  let event: { event_type?: unknown; event_id?: unknown; message?: Record<string, unknown> };
  try { event = JSON.parse(rawBody); } catch { throw new ChannelError(PROVIDER, 'malformed webhook JSON', 400); }
  if (!event || typeof event !== 'object') throw new ChannelError(PROVIDER, 'malformed webhook JSON', 400);
  const eventType = event.event_type;
  if (eventType !== 'message.received') throw new ChannelError(PROVIDER, `ignoring event ${String(eventType)}`, 422);
  const m = event.message;
  if (!m || typeof m !== 'object' || typeof m.thread_id !== 'string' || typeof m.message_id !== 'string') throw new ChannelError(PROVIDER, 'malformed message.received payload', 400);
  const contactId = await isKnownThread(m.thread_id);
  if (!contactId) throw new ChannelError(PROVIDER, 'not a Wayfinder thread', 404);
  const at = new Date(typeof m.timestamp === 'string' || typeof m.timestamp === 'number' ? m.timestamp : NaN);
  return {
    provider: PROVIDER, channel: 'email', eventType, contactId, threadId: m.thread_id, messageId: m.message_id,
    body: String(m.extracted_text ?? m.text ?? ''), receivedAt: (Number.isNaN(at.getTime()) ? now() : at).toISOString(),
    ...(typeof event.event_id === 'string' ? { eventId: event.event_id } : {}),
    ...(typeof m.inbox_id === 'string' ? { inboxId: m.inbox_id } : {}),
    ...(typeof m.from === 'string' ? { from: m.from } : {}),
    ...(typeof m.subject === 'string' ? { subject: m.subject } : {}),
  };
}
