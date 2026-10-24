/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Playwright locators and a tiny DOM */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunStore } from '@/lib/agents/run-store';
import { MemoryDocumentStore } from '@/lib/case-docs';
import { MockBrowserProvider, TEST_APPLICATION_URL } from '@/lib/channels/mock-browser';
import { ChannelError } from '@/lib/channels/types';
import { WebFormChannel } from '@/lib/channels/web-form';
import {
  KernelBrowserProvider, createKernelWebChannel, draftFillWebForm,
  type PageLike, type PlaywrightBrowserLike,
} from '@/lib/channels/kernel-web';

const kernelCtor = vi.hoisted(() => vi.fn());
const connectOverCDP = vi.hoisted(() => vi.fn());
vi.mock('@onkernel/sdk', () => ({ default: kernelCtor }));
vi.mock('playwright-core', () => ({ chromium: { connectOverCDP } }));

// ---------------------------------------------------------------------------
// A tiny DOM, just enough for the serialized in-page collector script.
// ---------------------------------------------------------------------------
interface FakeSpec {
  tag: string; attrs?: Record<string, string>; text?: string; options?: string[];
  wrapLabel?: string; legend?: string; inFieldset?: boolean;
}
function makeDocument(specs: FakeSpec[], labels: Record<string, string> = {}) {
  const els = specs.map((s) => {
    const attrs = s.attrs ?? {};
    const el: any = {
      tagName: s.tag.toUpperCase(), spec: s,
      getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
      hasAttribute: (n: string) => n in attrs,
      setAttribute: (n: string, v: string) => { attrs[n] = v; },
      options: (s.options ?? []).map(t => ({ textContent: t })),
      closest: (sel: string) => {
        if (sel === 'label') return s.wrapLabel !== undefined ? { textContent: s.wrapLabel } : null;
        if (sel === 'fieldset') {
          if (!s.inFieldset) return null;
          return { querySelector: () => (s.legend !== undefined ? { textContent: s.legend } : null) };
        }
        return null;
      },
    };
    return el;
  });
  return {
    body: { innerText: 'x' },
    querySelectorAll: () => ({ forEach: (cb: (e: unknown) => void) => els.forEach(cb) }),
    querySelector: (sel: string) => {
      const forMatch = /^label\[for="(.*)"\]$/.exec(sel);
      if (forMatch) { const t = labels[forMatch[1]!.replace(/\\"/g, '"')]; return t === undefined ? null : { textContent: t }; }
      const radio = /^input\[type=radio\]\[name="(.*)"\]$/.exec(sel);
      if (radio) return els.find(e => e.getAttribute('name') === radio[1]!.replace(/\\"/g, '"') && e.getAttribute('type') === 'radio') ?? null;
      return null;
    },
  };
}

/** Page whose evaluate() runs the serialized collector (string) or a function against a fake document. */
function domPage(doc: any, urlValue = 'https://x.test/form') {
  const loc: any = { first: () => loc };
  const calls: string[] = [];
  for (const m of ['fill', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'click']) loc[m] = vi.fn(async (...a: unknown[]) => { calls.push(`${m}:${JSON.stringify(a[0] ?? null)}`); });
  const page: PageLike = {
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fn: unknown) => {
      vi.stubGlobal('document', doc);
      try { return typeof fn === 'string' ? (0, eval)(fn) : (fn as () => unknown)(); } finally { vi.unstubAllGlobals(); }
    }) as any,
    locator: vi.fn(() => loc),
    screenshot: vi.fn(async () => Buffer.from('png')),
    url: () => urlValue,
    waitForLoadState: vi.fn(async () => undefined),
  };
  return { page, loc, calls };
}

function rig(page: PageLike, over: { contexts?: any; close?: () => Promise<void>; deleteByID?: () => Promise<void>; connectError?: unknown } = {}) {
  const browser: PlaywrightBrowserLike = {
    contexts: over.contexts ?? (() => [{ pages: () => [page], newPage: async () => page }]),
    newContext: async () => ({ newPage: async () => page }),
    close: over.close ?? (async () => undefined),
  };
  const client = {
    browsers: {
      create: vi.fn(async () => ({ cdp_ws_url: 'wss://cdp', session_id: 's1' })),
      deleteByID: vi.fn(over.deleteByID ?? (async () => undefined)),
    },
  };
  const connect = vi.fn(async () => { if ('connectError' in over) throw over.connectError; return browser; });
  const provider = new KernelBrowserProvider({ apiKey: 'k-test', client, connect });
  return { provider, client, connect, browser };
}

beforeEach(() => { kernelCtor.mockReset(); connectOverCDP.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('in-page field collector (run against a fake DOM)', () => {
  const specs: FakeSpec[] = [
    { tag: 'input', attrs: { type: 'hidden', name: 'csrf' } },
    { tag: 'input', attrs: { type: 'submit' } },
    { tag: 'input', attrs: { id: 'nm', name: 'fullName', required: '' } },
    { tag: 'input', attrs: { type: 'EMAIL', id: 'we"ird' } },
    { tag: 'input', attrs: { type: 'tel', 'aria-label': 'Phone number' } },
    { tag: 'input', attrs: { type: 'url', placeholder: 'Website' } },
    { tag: 'input', attrs: { type: 'text', name: 'wrapped' }, wrapLabel: ' Wrapped label ' },
    { tag: 'input', attrs: { type: 'text' } },
    { tag: 'textarea', attrs: { name: 'story' } },
    { tag: 'select', attrs: { name: 'state' }, options: ['MA ', 'NY'] },
    { tag: 'input', attrs: { type: 'radio', name: 'pref' }, wrapLabel: 'Email', inFieldset: true, legend: ' Preferred contact ' },
    { tag: 'input', attrs: { type: 'radio', name: 'pref', required: '' }, wrapLabel: 'Phone', inFieldset: true, legend: ' Preferred contact ' },
    { tag: 'input', attrs: { type: 'radio', name: 'solo' }, wrapLabel: 'Only', inFieldset: false },
    { tag: 'input', attrs: { type: 'radio' }, wrapLabel: 'Nameless radio' },
    { tag: 'input', attrs: { type: 'checkbox', name: 'agree' }, wrapLabel: 'I agree' },
    { tag: 'input', attrs: { type: 'file', name: 'docs' } },
    { tag: 'input', attrs: { type: 'color', name: 'shade' } },
  ];
  const labels = { nm: 'Full name', 'we"ird': 'Weird id' };

  it('tags controls, groups radios, resolves labels and skips non-fillable inputs', async () => {
    // Arrange
    const { page } = domPage(makeDocument(specs, labels));
    const { provider } = rig(page);
    const session = await provider.launch();

    // Act
    const snap = await session.open('https://x.test/form');

    // Assert
    const byKey = Object.fromEntries(snap.fields.map(f => [f.key, f]));
    expect(byKey.fullName).toMatchObject({ label: 'Full name', type: 'text', required: true });
    expect(byKey['we"ird']).toMatchObject({ label: 'Weird id', type: 'email' });
    expect(snap.fields.find(f => f.label === 'Phone number')?.type).toBe('tel');
    expect(snap.fields.find(f => f.label === 'Website')?.type).toBe('url');
    expect(byKey.wrapped?.label).toBe('Wrapped label');
    expect(byKey['field-5']).toMatchObject({ label: '', type: 'text' });
    expect(byKey.story?.type).toBe('textarea');
    expect(byKey.state).toMatchObject({ type: 'select', options: ['MA', 'NY'] });
    expect(byKey.pref).toMatchObject({ type: 'radio', label: 'Preferred contact', required: true, options: ['Email', 'Phone'] });
    expect(byKey.solo?.label).toBe('solo');
    expect(byKey.agree?.type).toBe('checkbox');
    expect(byKey.docs?.type).toBe('file');
    expect(byKey.shade?.type).toBe('other');
    expect(snap.fields.some(f => f.key === 'csrf')).toBe(false);
    expect(snap.url).toBe('https://x.test/form');
  });

  it('de-duplicates repeated names and falls back to positional keys', async () => {
    const { page } = domPage(makeDocument([
      { tag: 'input', attrs: { name: 'dup' } }, { tag: 'input', attrs: { name: 'dup' } }, { tag: 'input', attrs: { name: 'dup' } },
    ]));
    const session = await rig(page).provider.launch();

    const snap = await session.open('https://x.test/form');

    expect(snap.fields.map(f => f.key)).toEqual(['dup', 'dup-2', 'dup-3']);
  });

  it('maps a raw select-one type to select and unknown raw types to other', async () => {
    const raw = (type: string, index: number) => ({ index, tag: 'input', type, name: `n${index}`, id: '', label: 'L', required: false, options: ['a'], optionIndexes: [] });
    const { page } = domPage(makeDocument([]));
    (page.evaluate as any).mockResolvedValueOnce([raw('select-one', 0), raw('weird', 1)]);
    const session = await rig(page).provider.launch();

    const snap = await session.readFields();

    expect(snap.fields.map(f => f.type)).toEqual(['select', 'other']);
    expect(snap.fields[0]?.options).toEqual(['a']);
    expect(snap.fields[1]?.options).toBeUndefined();
  });
});

describe('KernelSession fill/upload/submit branches', () => {
  async function sessionFor(specs: FakeSpec[], labels: Record<string, string> = {}) {
    const d = domPage(makeDocument(specs, labels));
    const session = await rig(d.page).provider.launch();
    await session.open('https://x.test/form');
    return { ...d, session };
  }
  const form: FakeSpec[] = [
    { tag: 'input', attrs: { name: 'agree', type: 'checkbox' } },
    { tag: 'input', attrs: { name: 'docs', type: 'file' } },
    { tag: 'input', attrs: { name: 'pref', type: 'radio' }, wrapLabel: 'Email' },
    { tag: 'input', attrs: { name: 'pref', type: 'radio' }, wrapLabel: 'Phone' },
    { tag: 'select', attrs: { name: 'state' }, options: ['MA', 'NY'] },
    { tag: 'input', attrs: { name: 'full' } },
  ];

  it('ticks, unticks, picks radios and options, and fills text', async () => {
    const { session, calls } = await sessionFor(form);

    await session.fill({ agree: true });
    await session.fill({ agree: 'true' });
    await session.fill({ agree: false });
    await session.fill({ pref: 'Phone' });
    await session.fill({ state: 'NY', full: 'Pat Example' });

    expect(calls).toEqual([
      'check:null', 'check:null', 'uncheck:null', 'check:null',
      'selectOption:{"label":"NY"}', 'fill:"Pat Example"',
    ]);
  });

  it('rejects unknown keys, file fields in fill(), and unknown radio options', async () => {
    const { session, calls } = await sessionFor(form);

    await expect(session.fill({ nope: 'x' })).rejects.toThrow(/Unknown field key: nope/);
    await expect(session.fill({ docs: 'x' })).rejects.toThrow(/Use upload\(\) for file field/);
    await expect(session.fill({ pref: 'Carrier pigeon' })).rejects.toThrow(/Unknown option for pref/);
    expect(calls).toEqual([]);
  });

  it('refuses a radio option whose index is missing from the group', async () => {
    const { page } = domPage(makeDocument([]));
    (page.evaluate as any).mockResolvedValueOnce([{ index: 0, tag: 'input', type: 'radio', name: 'r', id: '', label: 'R', required: false, options: ['A', 'B'], optionIndexes: [0] }]);
    const session = await rig(page).provider.launch();
    await session.readFields();

    await expect(session.fill({ r: 'B' })).rejects.toThrow(/Unknown option for r/);
  });

  it('uploads only to file fields', async () => {
    const { session, calls } = await sessionFor(form);
    const file = { name: 'a.pdf', mimeType: 'application/pdf', content: new Uint8Array([1, 2]) };

    await session.upload({ ...file, fieldKey: 'docs' });
    await expect(session.upload({ ...file, fieldKey: 'full' })).rejects.toThrow(/Not a file field/);
    await expect(session.upload({ ...file, fieldKey: 'missing' })).rejects.toThrow(/Unknown field key/);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('setInputFiles');
  });

  it('screenshots as base64', async () => {
    const { session } = await sessionFor(form);
    expect(await session.screenshot()).toBe(Buffer.from('png').toString('base64'));
  });

  it('submit returns the final url without confirmation text when the page is blank or has no body', async () => {
    const blank = domPage({ ...makeDocument([]), body: { innerText: '   ' } });
    const noBody = domPage({ ...makeDocument([]), body: null });

    const a = await (await rig(blank.page).provider.launch()).submit();
    const b = await (await rig(noBody.page).provider.launch()).submit();

    expect(a).toEqual({ finalUrl: 'https://x.test/form' });
    expect(b).toEqual({ finalUrl: 'https://x.test/form' });
  });

  it('submit returns sanitized confirmation text when present', async () => {
    const d = domPage({ ...makeDocument([]), body: { innerText: 'Thank you, received.' } });

    const res = await (await rig(d.page).provider.launch()).submit();

    expect(res.confirmationText).toContain('Thank you');
  });
});

describe('KernelBrowserProvider launch and cleanup', () => {
  it('opens a new page in an existing context that has no pages', async () => {
    const d = domPage(makeDocument([]));
    const newPage = vi.fn(async () => d.page);
    const { provider } = rig(d.page, { contexts: () => [{ pages: () => [], newPage }] });

    await provider.launch();

    expect(newPage).toHaveBeenCalledOnce();
  });

  it('creates a context when the browser has none', async () => {
    const d = domPage(makeDocument([]));
    const { provider, browser } = rig(d.page, { contexts: () => [] });
    const spy = vi.spyOn(browser, 'newContext');

    await provider.launch();

    expect(spy).toHaveBeenCalledOnce();
  });

  it('wraps connect failures (Error and non-Error), deletes the session and never throws from cleanup', async () => {
    const d = domPage(makeDocument([]));
    const first = rig(d.page, { connectError: new Error('cdp down'), deleteByID: async () => { throw new Error('gone'); } });
    const second = rig(d.page, { connectError: 'string failure' });

    await expect(first.provider.launch()).rejects.toThrow(/Could not start a browser session: cdp down/);
    await expect(second.provider.launch()).rejects.toThrow(/Could not start a browser session: unknown error/);
    expect(first.client.browsers.deleteByID).toHaveBeenCalledWith('s1');
    expect(second.client.browsers.deleteByID).toHaveBeenCalledWith('s1');
  });

  it('closes the browser when page setup fails after connecting, ignoring a failing close', async () => {
    const d = domPage(makeDocument([]));
    const close = vi.fn(async () => { throw new Error('close failed'); });
    const { provider } = rig(d.page, { close, contexts: () => { throw new Error('no contexts'); } });

    await expect(provider.launch()).rejects.toBeInstanceOf(ChannelError);
    expect(close).toHaveBeenCalledOnce();
  });

  it('close() is idempotent and swallows browser and cleanup errors', async () => {
    const d = domPage(makeDocument([]));
    const close = vi.fn(async () => { throw new Error('x'); });
    const { provider, client } = rig(d.page, { close, deleteByID: async () => { throw new Error('y'); } });
    const session = await provider.launch();

    await session.close();
    await session.close();

    expect(close).toHaveBeenCalledOnce();
    expect(client.browsers.deleteByID).toHaveBeenCalledOnce();
  });

  it('is unconfigured for a whitespace-only key and refuses to launch', async () => {
    const provider = new KernelBrowserProvider({ apiKey: '   ' });
    expect(provider.status).toBe('unconfigured');
    await expect(provider.launch()).rejects.toThrow(/KERNEL_API_KEY missing/);
  });

  it('lazily loads the Kernel SDK and playwright when no client or connect is injected', async () => {
    const d = domPage(makeDocument([]));
    const browser: PlaywrightBrowserLike = { contexts: () => [{ pages: () => [d.page], newPage: async () => d.page }], newContext: async () => ({ newPage: async () => d.page }), close: async () => undefined };
    const deleteByID = vi.fn(async () => undefined);
    kernelCtor.mockImplementation(function (this: any) {
      this.browsers = { create: async () => ({ cdp_ws_url: 'wss://cdp', session_id: 's9' }), deleteByID };
    });
    connectOverCDP.mockResolvedValue(browser);
    const provider = new KernelBrowserProvider({ apiKey: ' key-from-env ' });

    const session = await provider.launch();
    await session.close();

    expect(kernelCtor).toHaveBeenCalledWith({ apiKey: 'key-from-env' });
    expect(connectOverCDP).toHaveBeenCalledWith('wss://cdp');
    expect(deleteByID).toHaveBeenCalledWith('s9');
  });
});

describe('createKernelWebChannel', () => {
  const guard = { allowlist: [] as string[], webAllowlist: ['x.test'] };

  it('builds an unconfigured channel when no key is given', () => {
    const channel = createKernelWebChannel({ guard });
    expect(channel.status).toBe('unconfigured');
    expect(channel.providerName).toBe('kernel');
  });

  it('threads key, client, connect and upload loader through', () => {
    const client = { browsers: { create: vi.fn(), deleteByID: vi.fn() } };
    const channel = createKernelWebChannel({ apiKey: 'k', guard, client: client as any, connect: vi.fn() as any, loadUpload: vi.fn() as any });
    expect(channel.status).toBe('ready');
  });
});

describe('draftFillWebForm branches', () => {
  const guard = { allowlist: [] as string[], webAllowlist: ['localhost:3000'] };
  const base = { caseId: 'case-1', caseRecord: { patientName: 'Pat Example' }, sharedFields: ['patientName'], docStore: new MemoryDocumentStore(), runStore: new MemoryRunStore() };

  beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('ANTHROPIC_API_KEY', ''); });
  afterEach(() => vi.unstubAllEnvs());

  it('throws when the page has no form', async () => {
    const provider = new MockBrowserProvider({ [TEST_APPLICATION_URL]: { fields: [] } });
    const channel = new WebFormChannel({ provider, guard });

    await expect(draftFillWebForm(channel, { ...base, url: TEST_APPLICATION_URL })).rejects.toThrow(/No application form found/);
    expect(provider.submissions).toHaveLength(0);
  });

  it('records the contact id and flags free text in the safety draft', async () => {
    const provider = new MockBrowserProvider({
      [TEST_APPLICATION_URL]: { fields: [
        { key: 'fullName', label: 'Full name', type: 'text', required: true },
        { key: 'notes', label: 'Anything else you want to tell us', type: 'textarea', required: false },
      ] },
    });
    const channel = new WebFormChannel({ provider, guard });

    const draft = await draftFillWebForm(channel, { ...base, contactId: 'c-9', url: TEST_APPLICATION_URL });

    expect(draft.safetyDraft.contactId).toBe('c-9');
    expect(draft.safetyDraft.webForm?.hasFreeText).toBe(true);
  });

  it('omits the contact id and free-text flag when there is neither', async () => {
    const provider = new MockBrowserProvider({
      [TEST_APPLICATION_URL]: { fields: [{ key: 'fullName', label: '', type: 'text', required: true }] },
    });
    const channel = new WebFormChannel({ provider, guard });

    const draft = await draftFillWebForm(channel, { ...base, url: TEST_APPLICATION_URL });

    expect(draft.safetyDraft.contactId).toBeUndefined();
    expect(draft.safetyDraft.webForm?.hasFreeText).toBe(false);
  });
});
