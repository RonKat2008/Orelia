import { describe, expect, it } from 'vitest';
import type { BrowserProvider, BrowserSession, PageSnapshot } from '../../lib/channels/browser-types';
import { WebFormChannel } from '../../lib/channels/web-form';

/** A browser whose allowlisted start page redirects to another host. */
function redirectingProvider(finalUrl: string, log: string[]): BrowserProvider {
  const snap: PageSnapshot = { url: finalUrl, fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] };
  const session: BrowserSession = {
    open: async () => snap,
    readFields: async () => snap,
    fill: async () => { log.push('fill'); },
    upload: async () => { log.push('upload'); },
    screenshot: async () => { log.push('screenshot'); return ''; },
    submit: async () => { log.push('submit'); return { finalUrl }; },
    close: async () => { log.push('close'); },
  };
  return { name: 'mock-browser', status: 'ready', launch: async () => session };
}

const guard = { allowlist: [], mode: 'dev' as const, webAllowlist: ['apply.example.org'] };

describe('web form redirects', () => {
  it('refuses to read or fill a page that redirected off the web allowlist', async () => {
    const log: string[] = [];
    const channel = new WebFormChannel({ provider: redirectingProvider('https://evil.example/collect', log), guard });
    await expect(channel.readForm('https://apply.example.org/form')).rejects.toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    await expect(channel.fillPreview('https://apply.example.org/form', { name: 'Synthetic' })).rejects.toThrow(/OUTBOUND_WEB_ALLOWLIST/);
    expect(log).not.toContain('fill');
    expect(log).toContain('close');
  });

  it('still reads an allowlisted page that stays on an allowlisted host', async () => {
    const channel = new WebFormChannel({ provider: redirectingProvider('https://apply.example.org/form?step=1', []), guard });
    expect((await channel.readForm('https://apply.example.org/form')).fields).toHaveLength(1);
  });
});
