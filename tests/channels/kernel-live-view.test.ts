/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles */
import { describe, expect, it, vi } from 'vitest';
import { KernelBrowserProvider } from '../../lib/channels/kernel-web';
import { readOnlyLiveViewUrl, withLiveViewScope, type LiveViewSink, type LiveViewStart } from '../../lib/channels/live-view';

function setup(liveUrl: string | undefined = 'https://api.onkernel.com/browser/live/TOKEN') {
  const page: any = { goto: vi.fn(), evaluate: vi.fn(async () => []), locator: () => ({ first() { return this; }, fill: vi.fn() }), screenshot: vi.fn(), url: () => 'x', waitForLoadState: vi.fn() };
  const browser = { contexts: () => [{ pages: () => [page], newPage: async () => page }], newContext: async () => ({ newPage: async () => page }), close: vi.fn(async () => undefined) };
  const client = { browsers: { create: vi.fn(async () => ({ cdp_ws_url: 'wss://cdp', session_id: 's1', ...(liveUrl ? { browser_live_view_url: liveUrl } : {}) })), deleteByID: vi.fn(async () => undefined) } };
  const started: LiveViewStart[] = [];
  const ended: string[] = [];
  const sink: LiveViewSink = { start: async (v) => { started.push(v); return `id${started.length}`; }, end: async (id) => { ended.push(id); } };
  const sleep = vi.fn(async () => undefined);
  const provider = new KernelBrowserProvider({ apiKey: 'k', client, connect: async () => browser as any, liveViewSink: sink, sleep, liveViewHoldMs: 7000 });
  return { provider, started, ended, sleep, client };
}
const scope = { caseId: 'c1', contactId: 'k1', phase: 'filling' as const };

describe('Kernel live view capture', () => {
  it('records a read-only live view url for the scoped case/contact/phase', async () => {
    const t = setup();
    await withLiveViewScope(scope, () => t.provider.launch());
    expect(t.started).toHaveLength(1);
    expect(t.started[0]).toMatchObject({ caseId: 'c1', contactId: 'k1', phase: 'filling', host: 'api.onkernel.com' });
    expect(t.started[0]!.url).toBe('https://api.onkernel.com/browser/live/TOKEN?readOnly=true');
    expect(t.started[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('records nothing without a scope, without a url, or for non-https urls', async () => {
    const a = setup(); await a.provider.launch(); expect(a.started).toHaveLength(0);
    const b = setup(undefined); await withLiveViewScope(scope, () => b.provider.launch()); expect(b.started).toHaveLength(0);
    const c = setup('http://evil.test/x'); await withLiveViewScope(scope, () => c.provider.launch()); expect(c.started).toHaveLength(0);
  });
  it('holds a filled browser open before closing, then expires the live view', async () => {
    const t = setup();
    const s = await withLiveViewScope(scope, () => t.provider.launch());
    await s.fill({}); // a fill (even empty) marks the session as having filled
    await s.close();
    expect(t.sleep).toHaveBeenCalledWith(7000);
    expect(t.ended).toEqual(['id1']);
    expect(t.client.browsers.deleteByID).toHaveBeenCalledWith('s1');
  });
  it('does not hold a read-only session, but still ends the live view', async () => {
    const t = setup();
    const s = await withLiveViewScope(scope, () => t.provider.launch());
    await s.close();
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.ended).toEqual(['id1']);
  });
  it('never fails the launch when the sink throws', async () => {
    const t = setup();
    const bad = new KernelBrowserProvider({ apiKey: 'k', client: t.client, connect: async () => ({ contexts: () => [], newContext: async () => ({ newPage: async () => ({}) }), close: async () => undefined }) as any, liveViewSink: { start: async () => { throw new Error('db down'); }, end: async () => undefined } });
    await expect(withLiveViewScope(scope, () => bad.launch())).resolves.toBeTruthy();
  });
  it('readOnlyLiveViewUrl keeps existing params and rejects junk', () => {
    expect(readOnlyLiveViewUrl('https://a.onkernel.com/x?y=1')).toBe('https://a.onkernel.com/x?y=1&readOnly=true');
    expect(readOnlyLiveViewUrl('not a url')).toBeNull();
  });
});
