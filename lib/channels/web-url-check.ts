import { isWebAllowed } from '../safety/web-allowlist';
import { ChannelError, type ChannelGuardOptions, type ProviderName } from './types';

/** URL rules shared by assertGated (web_form) and the no-submit preview paths. Returns nothing; throws ChannelError. */
export function checkWebUrl(url: string, provider: ProviderName, guard: ChannelGuardOptions): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ChannelError(provider, 'Refusing invalid address'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ChannelError(provider, 'Refusing invalid address');
  const real = guard.mode === 'prod' && guard.outboundAllowReal === 'true';
  if (!real && !isWebAllowed(url, guard.webAllowlist ?? [])) {
    throw new ChannelError(provider, 'Refusing host that is not on OUTBOUND_WEB_ALLOWLIST');
  }
}
