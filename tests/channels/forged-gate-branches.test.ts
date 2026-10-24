/**
 * Defensive second-lock branches in the adapters that checkOutbound normally makes unreachable.
 * isGatedDraft is stubbed to accept hand-built payloads so we can prove each adapter still refuses them.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/safety/outbound-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/safety/outbound-gate')>()),
  isGatedDraft: () => true,
}));

import { AgentCallChannel } from '@/lib/channels/agentcall';
import { MockBrowserProvider } from '@/lib/channels/mock-browser';
import { MockCaller } from '@/lib/channels/mock-caller';
import { assertGated, ChannelError, type ChannelGuardOptions, type GatedDraft } from '@/lib/channels/types';
import { WebFormChannel } from '@/lib/channels/web-form';
import { fingerprintFields, type PageField } from '@/lib/channels/browser-types';
import { AI_DISCLOSURE_VOICE } from '@/lib/safety/disclosure';
import { TEST_EMAIL, TEST_PHONE } from './helpers';

const guard: ChannelGuardOptions = { allowlist: [TEST_EMAIL, TEST_PHONE], webAllowlist: ['forms.example.org'] };
const URL_OK = 'https://forms.example.org/apply';
const hand = (over: Record<string, unknown>) => ({ approvedAt: '2026-10-28T15:00:00Z', sharedFields: [], caseData: {}, body: 'x', ...over }) as unknown as GatedDraft;

describe('assertGated second lock', () => {
  it('refuses a payload whose channel does not match the adapter', () => {
    expect(() => assertGated(hand({ channel: 'voice', address: TEST_PHONE }), 'email', 'agentmail', guard)).toThrow(/Refusing voice payload on email channel/);
  });

  it('refuses unparseable and non-http(s) web addresses', () => {
    expect(() => assertGated(hand({ channel: 'web_form', address: 'not a url' }), 'web_form', 'kernel', guard)).toThrow(/invalid address/);
    expect(() => assertGated(hand({ channel: 'web_form', address: 'ftp://forms.example.org/x' }), 'web_form', 'kernel', guard)).toThrow(/invalid address/);
  });

  it('refuses off-allowlist web hosts and accepts allowlisted ones', () => {
    expect(() => assertGated(hand({ channel: 'web_form', address: 'https://evil.example/x' }), 'web_form', 'kernel', guard)).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(assertGated(hand({ channel: 'web_form', address: URL_OK }), 'web_form', 'kernel', guard)).toBe(URL_OK);
  });

  it('only lifts the web allowlist for prod with an explicit "true"', () => {
    const off = hand({ channel: 'web_form', address: 'https://evil.example/x' });
    expect(assertGated(off, 'web_form', 'kernel', { ...guard, mode: 'prod', outboundAllowReal: 'true' })).toBe('https://evil.example/x');
    expect(() => assertGated(off, 'web_form', 'kernel', { ...guard, mode: 'prod', outboundAllowReal: 'yes' })).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(() => assertGated(off, 'web_form', 'kernel', { ...guard, mode: 'demo', outboundAllowReal: 'true' })).toThrow(/OUTBOUND_WEB_ALLOWLIST/);
  });

  it('refuses malformed email addresses and allowlist misses, and lifts the allowlist only in real prod mode', () => {
    expect(() => assertGated(hand({ channel: 'email', address: 'nope' }), 'email', 'agentmail', guard)).toThrow(/invalid address/);
    const other = hand({ channel: 'email', address: 'stranger@example.com' });
    expect(() => assertGated(other, 'email', 'agentmail', guard)).toThrow(/OUTBOUND_ALLOWLIST/);
    expect(assertGated(other, 'email', 'agentmail', { ...guard, mode: 'prod', outboundAllowReal: 'true' })).toBe('stranger@example.com');
  });
});

describe('MockCaller / AgentCallChannel disclosure lock', () => {
  const noDisclosure = hand({ channel: 'voice', address: TEST_PHONE, body: 'Hi, can you book me in?' });
  const withDisclosure = (extra: Record<string, unknown> = {}) => hand({ channel: 'voice', address: TEST_PHONE, body: `  ${AI_DISCLOSURE_VOICE} Please book.`, ...extra });

  it('MockCaller refuses a script that does not start with the disclosure', async () => {
    const caller = new MockCaller(guard);
    await expect(caller.send(noDisclosure)).rejects.toThrow(/spoken AI disclosure/);
    expect(caller.calls).toHaveLength(0);
  });

  it('AgentCallChannel refuses a script that does not start with the disclosure before any request', async () => {
    const fetcher = vi.fn();
    const ch = new AgentCallChannel({ apiKey: 'k', fromNumberId: 'n', guard, fetcher: fetcher as unknown as typeof fetch });
    await expect(ch.send(noDisclosure)).rejects.toBeInstanceOf(ChannelError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('MockCaller records contact and case ids when present and omits them otherwise', async () => {
    const caller = new MockCaller(guard, () => new Date('2026-10-28T16:00:00Z'));

    await caller.send(withDisclosure({ contactId: 'c1', caseId: 'case-1' }));
    await caller.send(withDisclosure());

    expect(caller.calls[0]).toMatchObject({ contactId: 'c1', caseId: 'case-1', placedAt: '2026-10-28T16:00:00.000Z' });
    expect('contactId' in caller.calls[1]!).toBe(false);
    expect('caseId' in caller.calls[1]!).toBe(false);
  });
});

describe('WebFormChannel hand-built payload branches', () => {
  const fields: PageField[] = [{ key: 'doc', label: 'Doc', type: 'file', required: false }];
  const payload = (over: Record<string, unknown>) => hand({
    channel: 'web_form', address: URL_OK,
    webForm: { formFingerprint: fingerprintFields(fields), fields: [], uploads: [{ fieldKey: 'doc', docId: 'd1', name: 'a.pdf' }], hasFreeText: false },
    ...over,
  });

  it('refuses a web_form payload without form data', async () => {
    const provider = new MockBrowserProvider({ [URL_OK]: { fields } });
    const channel = new WebFormChannel({ provider, guard });

    await expect(channel.send(hand({ channel: 'web_form', address: URL_OK }))).rejects.toThrow(/without form data/);
    expect(provider.openSessions).toBe(0);
  });

  it('refuses when the upload loader returns nothing and still closes the session', async () => {
    const provider = new MockBrowserProvider({ [URL_OK]: { fields } });
    const loadUpload = vi.fn(async () => undefined as never);
    const channel = new WebFormChannel({ provider, guard, loadUpload });

    await expect(channel.send(payload({}))).rejects.toThrow(/Upload document not available: d1/);
    expect(provider.submissions).toHaveLength(0);
    expect(provider.closedSessions).toBe(1);
  });
});
