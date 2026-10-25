import { describe, expect, it } from 'vitest';
import { ChannelError } from '@/lib/channels/types';
import { providerDetail } from '@/lib/outreach/http';

describe('providerDetail', () => {
  it('reports status and code, and the message when it adds something', () => {
    expect(providerDetail(new ChannelError('agentcall', 'HTTP 403', 403, false, { code: 'plan_limit_outbound_calls', message: 'Outbound calls require Pro' })))
      .toBe('agentcall: HTTP 403 plan_limit_outbound_calls. Outbound calls require Pro');
  });
  it('accepts a nested error object and ignores non-https upgrade links', () => {
    expect(providerDetail(new ChannelError('agentcall', 'HTTP 422', 422, false, { error: { message: 'to must be E.164' }, upgradeUrl: 'javascript:alert(1)' })))
      .toBe('agentcall: HTTP 422. to must be E.164');
  });
  it('falls back to the status alone and to nothing for a bare network error', () => {
    expect(providerDetail(new ChannelError('agentmail', 'HTTP 500', 500, true, 'gateway timeout'))).toBe('agentmail: HTTP 500');
    expect(providerDetail(new ChannelError('agentmail', 'Network error', undefined, true))).toBeUndefined();
  });
  it('caps the line length', () => {
    const detail = providerDetail(new ChannelError('agentcall', 'HTTP 403', 403, false, { message: 'x'.repeat(1000) }));
    expect(detail!.length).toBeLessThanOrEqual(300);
  });
});
