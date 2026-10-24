import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWebFormChannel, setWebFormChannelForTests, UnavailableWebFormChannel, type WebFormChannel } from '@/lib/plan/channels';

afterEach(() => setWebFormChannelForTests(undefined));

describe('web form channel', () => {
  it('default implementation reports not_available without any network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ch = getWebFormChannel();
    expect(ch).toBeInstanceOf(UnavailableWebFormChannel);
    expect(await ch.probeForm('https://example.org/apply')).toMatchObject({ ok: false, status: 'not_available' });
    expect(await ch.draftFill({ url: 'https://example.org/apply', fields: [], sharedValues: {} })).toMatchObject({ ok: false, status: 'not_available' });
    expect(await ch.submitGated({} as never, { url: 'https://example.org/apply', values: {} })).toMatchObject({ ok: false, status: 'not_available' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('allows injection and clearing', async () => {
    const fake: WebFormChannel = new UnavailableWebFormChannel('custom reason');
    setWebFormChannelForTests(fake);
    expect(getWebFormChannel()).toBe(fake);
    expect(await fake.probeForm('x')).toEqual({ ok: false, status: 'not_available', reason: 'custom reason' });
    setWebFormChannelForTests(undefined);
    expect(getWebFormChannel()).not.toBe(fake);
  });
});
