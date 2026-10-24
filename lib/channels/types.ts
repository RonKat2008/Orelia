import { isGatedDraft } from '../safety/outbound-gate';
import { isAllowed, normalizeAddress } from '../safety/allowlist';
import type { GatedDraft } from '../safety/outbound-gate';
export type { GatedDraft } from '../safety/outbound-gate';

export type ChannelKind = 'email' | 'voice';
export type ProviderName = 'agentmail' | 'agentcall' | 'mock-mailer' | 'mock-caller';

/** Provider ids stored on messages/calls rows; later replies and webhooks are matched against these. */
export interface ProviderRef {
  readonly provider: ProviderName;
  readonly channel: ChannelKind;
  readonly inboxId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly callId?: string;
  readonly status?: string;
}

/** Adapters accept only the payload checkOutbound produced; raw drafts do not type-check. */
export interface Channel {
  readonly kind: ChannelKind;
  send(gated: GatedDraft): Promise<ProviderRef>;
}

/** Status/body come from the provider; secrets and request bodies are never copied in. */
export class ChannelError extends Error {
  constructor(
    public provider: ProviderName,
    message: string,
    public status?: number,
    public retryable = false,
    public body?: unknown,
  ) {
    super(`${provider}: ${message}`); this.name = 'ChannelError';
  }
}

export interface ChannelGuardOptions {
  /** Same allowlist the gate used; adapters re-check it as a second lock (hard rule 4). */
  allowlist: readonly string[];
  /** Only an explicit 'true' together with mode 'prod' lifts the allowlist, mirroring checkOutbound. */
  mode?: 'dev' | 'demo' | 'prod';
  outboundAllowReal?: string;
}

/**
 * Runtime guard behind the compile-time GatedDraft brand: the gate deep-freezes its payload, so a
 * hand-built or cast object is rejected here before any network call.
 */
export function assertGated(gated: GatedDraft, kind: ChannelKind, provider: ProviderName, guard: ChannelGuardOptions): string {
  if (!isGatedDraft(gated)) {
    throw new ChannelError(provider, 'Refusing payload that did not come from checkOutbound');
  }
  if (gated.channel !== kind) throw new ChannelError(provider, `Refusing ${gated.channel} payload on ${kind} channel`);
  const address = normalizeAddress(gated.address);
  if (!address) throw new ChannelError(provider, 'Refusing invalid address');
  const real = guard.mode === 'prod' && guard.outboundAllowReal === 'true';
  if (!real && !isAllowed(address, guard.allowlist)) throw new ChannelError(provider, 'Refusing address that is not on OUTBOUND_ALLOWLIST');
  return address;
}

/** Inbound reply or call result, already matched to a provider thread/call that Wayfinder created. */
export interface ProviderInbound {
  readonly provider: ProviderName;
  readonly channel: ChannelKind;
  readonly eventType: string;
  readonly eventId?: string;
  readonly inboxId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly callId?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly status?: string;
}

/** Looks up a stored provider id; returns the contact id only for threads/calls Wayfinder created. */
export type KnownThreadLookup = (providerId: string) => string | undefined | Promise<string | undefined>;
