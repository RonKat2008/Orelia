import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AI_DISCLOSURE_VOICE } from '../safety/disclosure';
import { assertGated, ChannelError, type Channel, type ChannelGuardOptions, type GatedDraft, type KnownThreadLookup, type ProviderInbound, type ProviderRef } from './types';

const P = 'agentcall' as const;
const DEFAULT_BASE_URL = 'https://api.agentcall.co';
const SCRIPT_RULES = 'Stay strictly on the approved script below. Give no medical advice. Do not share any information beyond what the script contains.';

export interface AgentCallOptions {
  apiKey: string;
  /** AgentCall number ID (e.g. "num_abc123"), not a phone number. */
  fromNumberId: string;
  guard: ChannelGuardOptions;
  fetcher?: typeof fetch;
  baseUrl?: string;
  systemPrompt?: string;
  voice?: string;
  maxDurationSecs?: number;
}

export interface Turn { role: 'ai' | 'human'; text: string; timestamp?: string }
export interface AgentCallInfo { callId: string; status?: string; transcript?: Turn[] }

export function transcriptToText(turns: readonly Turn[]): string {
  return turns.map(t => `${t.role === 'ai' ? 'AI' : 'Callee'}: ${t.text}`).join('\n');
}

/** Real voice caller. Only ever receives checkOutbound output; the disclosure is the first thing spoken. */
export class AgentCallChannel implements Channel {
  readonly kind = 'voice' as const;
  private fetcher: typeof fetch;
  private baseUrl: string;
  constructor(private opts: AgentCallOptions) {
    this.fetcher = opts.fetcher ?? fetch;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async send(gated: GatedDraft): Promise<ProviderRef> {
    const to = assertGated(gated, 'voice', P, this.opts.guard);
    if (!gated.body.trimStart().startsWith(AI_DISCLOSURE_VOICE)) throw new ChannelError(P, 'Script must begin with the spoken AI disclosure');
    const metadata = {
      ...(gated.contactId !== undefined ? { contactId: gated.contactId } : {}),
      ...(gated.caseId !== undefined ? { caseId: gated.caseId } : {}),
    };
    const body = {
      from: this.opts.fromNumberId, to,
      firstMessage: AI_DISCLOSURE_VOICE,
      systemPrompt: [this.opts.systemPrompt, SCRIPT_RULES, `Approved script:\n${gated.body.trim()}`].filter(Boolean).join('\n\n'),
      ...(this.opts.voice ? { voice: this.opts.voice } : {}),
      ...(this.opts.maxDurationSecs ? { maxDurationSecs: this.opts.maxDurationSecs } : {}),
      record: false,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      idempotencyKey: createHash('sha256').update(`${to}\n${gated.approvedAt}\n${gated.body}`).digest('hex').slice(0, 32),
    };
    const res = await this.request('POST', '/v1/calls/ai', body);
    const callId = pickId(res);
    if (!callId) throw new ChannelError(P, 'Response did not include a call id', undefined, false, res);
    return { provider: P, channel: 'voice', callId, ...(typeof res.status === 'string' ? { status: res.status } : {}) };
  }

  async getCall(callId: string): Promise<AgentCallInfo> {
    const res = await this.request('GET', `/v1/calls/${encodeURIComponent(callId)}`);
    return { callId: pickId(res) ?? callId, ...(typeof res.status === 'string' ? { status: res.status } : {}), ...(Array.isArray(res.transcript) ? { transcript: res.transcript as Turn[] } : {}) };
  }

  async getTranscript(callId: string): Promise<AgentCallInfo> {
    const res = await this.request('GET', `/v1/calls/${encodeURIComponent(callId)}/transcript`);
    const transcript = Array.isArray(res.transcript) ? res.transcript as Turn[] : Array.isArray(res) ? res as unknown as Turn[] : undefined;
    return { callId: pickId(res) ?? callId, ...(typeof res.status === 'string' ? { status: res.status } : {}), ...(transcript ? { transcript } : {}) };
  }

  private async request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ChannelError(P, `Network error: ${scrub((err as Error)?.message ?? 'request failed', this.opts.apiKey)}`, undefined, true);
    }
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = text; }
    if (!res.ok) throw new ChannelError(P, `HTTP ${res.status} from ${method} ${path}`, res.status, res.status === 429 || res.status >= 500, parsed);
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  }
}

function pickId(res: Record<string, unknown>): string | undefined {
  const id = res.id ?? res.callId;
  return typeof id === 'string' && id ? id : undefined;
}

function scrub(msg: string, key: string): string { return key ? msg.split(key).join('[redacted]') : msg; }

/** X-AgentCall-Signature: sha256=<hex HMAC-SHA256 of the raw body>. */
export function verifyAgentCallSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(m[1]!, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function headerValue(headers: Headers | Record<string, string | undefined>, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  const rec = headers as Record<string, string | undefined>;
  const key = Object.keys(rec).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key] ?? null : null;
}

export async function parseAgentCallWebhook(
  rawBody: string, headers: Headers | Record<string, string | undefined>, secret: string, isKnownCall: KnownThreadLookup,
): Promise<ProviderInbound & { contactId: string }> {
  if (!verifyAgentCallSignature(rawBody, headerValue(headers, 'x-agentcall-signature'), secret)) throw new ChannelError(P, 'Invalid webhook signature', 401);
  let env: { event?: unknown; timestamp?: unknown; data?: Record<string, unknown> };
  try { env = JSON.parse(rawBody); } catch { throw new ChannelError(P, 'Malformed webhook JSON', 400); }
  const data = env && typeof env === 'object' && env.data && typeof env.data === 'object' ? env.data : undefined;
  const event = typeof env?.event === 'string' ? env.event : undefined;
  const callId = typeof data?.callId === 'string' ? data.callId : undefined;
  if (!data || !event || !callId) throw new ChannelError(P, 'Malformed webhook envelope', 400);
  const contactId = await isKnownCall(callId);
  if (!contactId) throw new ChannelError(P, 'Call is not a Wayfinder call', 404);
  const receivedAt = typeof env.timestamp === 'string' ? env.timestamp : new Date().toISOString();
  const base = { provider: P, channel: 'voice' as const, eventType: event, callId, receivedAt, contactId };
  if (event === 'call.transcript') {
    const turns = Array.isArray(data.transcript) ? data.transcript as Turn[] : [];
    return { ...base, body: transcriptToText(turns), status: 'completed' };
  }
  if (event === 'call.status') return { ...base, body: '', ...(typeof data.status === 'string' ? { status: data.status } : {}) };
  return { ...base, body: '' };
}
