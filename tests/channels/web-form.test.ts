import { describe, expect, it } from 'vitest';
import { MockBrowserProvider, MockWebChannel } from '../../lib/channels/mock-browser';
import { WebFormChannel, PageChangedError } from '../../lib/channels/web-form';
import { ChannelError } from '../../lib/channels/types';
import { formFields, forgedWeb, FORM_URL, gatedWeb, webGuard } from './web-helpers';

const pages = { [FORM_URL]: { fields: formFields } };
const loadUpload = async () => ({ name: 'records.pdf', mimeType: 'application/pdf', content: new Uint8Array([1, 2]) });
const make = (opts: Partial<ConstructorParameters<typeof MockWebChannel>[0]> = {}) =>
  new MockWebChannel({ pages, guard: webGuard, loadUpload, ...opts });

describe('WebFormChannel.send', () => {
  it('submits an approved draft and closes the session', async () => {
    const ch = make();
    const ref = await ch.send(gatedWeb({ uploads: true }));
    expect(ref).toMatchObject({ provider: 'mock-browser', channel: 'web_form', status: 'submitted' });
    expect(ref.messageId).toBeUndefined();
    const sub = ch.browser.submissions[0]!;
    expect(sub.values).toMatchObject({ fullName: 'Pat Example', consentConfirm: true });
    expect(sub.uploads.map(u => u.fieldKey)).toEqual(['documents']);
    expect(ch.browser.openSessions).toBe(ch.browser.closedSessions);
  });
  it('refuses a payload that did not come from checkOutbound', async () => {
    const ch = make();
    await expect(ch.send(forgedWeb())).rejects.toBeInstanceOf(ChannelError);
    expect(ch.browser.submissions).toHaveLength(0);
    expect(ch.browser.openSessions).toBe(0);
  });
  it('refuses a host that is not on the web allowlist', async () => {
    const ch = make({ guard: { allowlist: [], webAllowlist: ['apply.example.org'] } });
    await expect(ch.send(gatedWeb())).rejects.toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(ch.browser.openSessions).toBe(0);
  });
  it('refuses with page_changed and submits nothing when the form differs', async () => {
    const ch = make();
    const gated = gatedWeb();
    ch.browser.mutatePage(FORM_URL, [...formFields, { key: 'ssn', label: 'SSN', type: 'text', required: true }]);
    const err = await ch.send(gated).catch(e => e);
    expect(err).toBeInstanceOf(PageChangedError);
    expect(err.message).toContain('page_changed');
    expect(err.retryable).toBe(false);
    expect(ch.browser.submissions).toHaveLength(0);
    expect(ch.browser.closedSessions).toBe(1);
  });
  it('requires an upload loader when the draft has uploads', async () => {
    const ch = new MockWebChannel({ pages, guard: webGuard });
    await expect(ch.send(gatedWeb({ uploads: true }))).rejects.toThrow(/upload loader/);
    expect(ch.browser.submissions).toHaveLength(0);
  });
});

describe('WebFormChannel preview', () => {
  it('readForm and fillPreview never submit', async () => {
    const ch = make();
    expect((await ch.readForm(FORM_URL)).fields).toHaveLength(4);
    const out = await ch.fillPreview(FORM_URL, { fullName: 'Pat' });
    expect(out.screenshot.length).toBeGreaterThan(10);
    expect(ch.browser.submissions).toHaveLength(0);
    expect(ch.browser.closedSessions).toBe(2);
  });
  it('limits previews to the web allowlist too', async () => {
    const ch = new WebFormChannel({ provider: new MockBrowserProvider({ 'http://evil.test/': { fields: [] } }), guard: webGuard });
    await expect(ch.readForm('http://evil.test/')).rejects.toThrow(/OUTBOUND_WEB_ALLOWLIST/);
  });
});
