/**
 * DEMO ONLY: "Take the call in your browser".
 *
 * When the phone line cannot place a call (Vapi's free number has a daily outbound limit), the presenter plays the
 * clinic coordinator and talks to the SAME call agent through the laptop mic. Nothing about the call changes except
 * the transport:
 *   - the approval is the normal one: OutreachService.approve (consent, checkOutbound: approved_at, allowlist,
 *     ticked fields only, AI disclosure first, no medical advice, <=5 active contacts, cadence, then reserve);
 *   - the assistant is built by buildVapiAssistant, exactly as for the phone (VapiWebCallChannel);
 *   - the calls row is written by the same delivered() step with the Vapi call id, so webhooks stream turns into
 *     call_turns and the end-of-call transcript goes through the normal ingest (inbox agent -> tasks -> agent wake).
 * It is offered only in demo mode, and the browser call reaches only the presenter: no number is dialed.
 */
import { isOffline, resolveMode } from '../env';
import { VapiWebCallChannel } from '../channels/vapi';
import type { ChannelGuardOptions } from '../channels/types';
import type { CallLiveStore } from './call-live';
import { demoDestinationsEnabled, outboundAllowlist } from './demo-destinations';
import { OutreachError, type Channel } from './types';
import type { OutreachService } from './service';

type Env = Record<string, string | undefined>;

export type BrowserCallUnavailable = 'not_demo' | 'offline' | 'web_call_unconfigured';
export type BrowserCallAvailability = { ok: true } | { ok: false; reason: BrowserCallUnavailable };

/**
 * Demo-only switch: demo destinations on (WAYFINDER_DEMO_COORDINATORS with an allowlisted coordinator inbox), or
 * the judge view in demo mode (WAYFINDER_MODE/WAYFINDER_DEMO). Needs the Vapi PUBLIC key; never in offline mode.
 */
export function browserCallAvailability(env: Env, opts: { judge?: boolean } = {}): BrowserCallAvailability {
  const demo = demoDestinationsEnabled(env) || (opts.judge === true && resolveMode(env) === 'demo');
  if (!demo) return { ok: false, reason: 'not_demo' };
  if (isOffline(env.WAYFINDER_OFFLINE?.trim().toLowerCase()) || resolveMode(env) === 'offline') return { ok: false, reason: 'offline' };
  if (!env.VAPI_PUBLIC_KEY?.trim()) return { ok: false, reason: 'web_call_unconfigured' };
  return { ok: true };
}

/**
 * The browser-call channel for this env: same webhook URL + secret and model as the phone channel. Its second lock
 * is the gate's own allowlist (outboundAllowlist: in demo mode that includes the never-dialed demo sink).
 */
export function webCallChannel(env: Env, deps: { serverUrl?: string; fetcher?: typeof fetch } = {}): VapiWebCallChannel {
  const publicKey = env.VAPI_PUBLIC_KEY?.trim();
  if (!publicKey) throw new OutreachError(503, ['browser_call_unavailable', 'web_call_unconfigured']);
  const guard: ChannelGuardOptions = {
    allowlist: outboundAllowlist(env),
    mode: env.NODE_ENV === 'production' ? 'prod' : 'dev',
    outboundAllowReal: env.OUTBOUND_ALLOW_REAL,
  };
  const webhookSecret = env.VAPI_WEBHOOK_SECRET?.trim();
  return new VapiWebCallChannel({
    publicKey, guard,
    ...(deps.serverUrl ? { serverUrl: deps.serverUrl } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
    ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
  });
}

/** What the browser needs to join, and nothing else (no assistant config, no secret, no private key). */
export interface BrowserCallStart {
  callId: string;
  webCallUrl: string;
  /** Vapi public key: designed to be public; the SDK needs it to construct its client. */
  publicKey: string;
  approvedAt: string;
}

export interface BrowserCallDeps {
  service: Pick<OutreachService, 'approve' | 'requireContact'>;
  channel: Channel;
  live?: Pick<CallLiveStore, 'upsertState'>;
  env: Env;
}

/**
 * Approves the drafted first call and starts it as a browser call. Refuses (before anything is created) when the
 * mode is off, the contact is not a call, or it was already contacted; the gate refuses everything else.
 */
export async function startBrowserCall(deps: BrowserCallDeps, contactId: string, draftId: string, opts: { judge?: boolean } = {}): Promise<BrowserCallStart> {
  const available = browserCallAvailability(deps.env, opts);
  if (!available.ok) throw new OutreachError(403, ['browser_call_unavailable', available.reason]);
  const contact = await deps.service.requireContact(contactId);
  if (contact.channel !== 'voice') throw new OutreachError(422, ['not_a_call']);
  if (contact.state !== 'drafted') throw new OutreachError(409, ['already_contacted']);
  const result = await deps.service.approve(contactId, draftId, { voiceChannel: deps.channel });
  if ('queued' in result || !result.provider.callId || !result.provider.webCallUrl) throw new OutreachError(502, ['send_status_unknown']);
  const { callId, webCallUrl } = result.provider;
  // Provider mark for the console ("Browser call"). The webhook keeps it (it sends 'vapi-web' for webCall too).
  try {
    await deps.live?.upsertState({ providerCallId: callId, contactId }, { provider: 'vapi-web', status: 'queued' });
  } catch (error) {
    console.error('[browser-call] live state mark failed', error instanceof Error ? error.name : 'unknown');
  }
  return { callId, webCallUrl, publicKey: deps.env.VAPI_PUBLIC_KEY!.trim(), approvedAt: result.approvedAt };
}
