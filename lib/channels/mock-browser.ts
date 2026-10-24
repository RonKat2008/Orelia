import { cleanLabel, cleanOptions } from './page-text';
import type { BrowserProvider, BrowserSession, FieldValue, PageField, PageSnapshot, UploadFile } from './browser-types';
import { ChannelError } from './types';
import { WebFormChannel, type LoadUpload } from './web-form';
import type { ChannelGuardOptions } from './types';

export interface MockPage { readonly fields: readonly PageField[] }
export interface MockSubmission {
  readonly url: string;
  readonly values: Readonly<Record<string, FieldValue>>;
  readonly uploads: readonly UploadFile[];
  readonly at: string;
}
export interface MockFillPreview { readonly url: string; readonly values: Readonly<Record<string, FieldValue>> }

/** 1x1 transparent PNG; deterministic stand-in for a screenshot. */
export const FAKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const sanitize = (fields: readonly PageField[]): PageField[] =>
  fields.map(f => {
    const options = cleanOptions(f.options);
    return { key: f.key, label: cleanLabel(f.label), type: f.type, required: f.required, ...(options ? { options } : {}) };
  });

/** In-memory browser for tests and the offline demo; nothing leaves the process. */
export class MockBrowserProvider implements BrowserProvider {
  readonly name = 'mock-browser' as const;
  readonly status = 'ready' as const;
  readonly submissions: MockSubmission[] = [];
  readonly fillPreviews: MockFillPreview[] = [];
  openSessions = 0;
  closedSessions = 0;
  private pages = new Map<string, MockPage>();

  constructor(pages: Readonly<Record<string, MockPage>> = {}, private now = () => new Date()) {
    for (const [url, page] of Object.entries(pages)) this.pages.set(url, { fields: [...page.fields] });
  }

  /** Simulate the live page changing after the patient reviewed it. */
  mutatePage(url: string, fields: readonly PageField[]): void { this.pages.set(url, { fields: [...fields] }); }
  pageFields(url: string): readonly PageField[] | undefined { return this.pages.get(url)?.fields; }
  /** @internal */ lookup(url: string) { return this.pages.get(url); }
  /** @internal */ record(s: MockSubmission) { this.submissions.push(s); }
  /** @internal */ recordPreview(p: MockFillPreview) { this.fillPreviews.push(p); }
  /** @internal */ clock() { return this.now(); }

  async launch(): Promise<BrowserSession> { this.openSessions++; return new MockSession(this, () => { this.closedSessions++; }); }
}

class MockSession implements BrowserSession {
  private url?: string;
  private values: Record<string, FieldValue> = {};
  private uploads: UploadFile[] = [];
  private closed = false;
  constructor(private provider: MockBrowserProvider, private onClose: () => void) {}

  private snapshot(): PageSnapshot {
    if (!this.url) throw new ChannelError('mock-browser', 'No page is open');
    const page = this.provider.lookup(this.url);
    if (!page) throw new ChannelError('mock-browser', 'Page not found');
    return { url: this.url, fields: sanitize(page.fields) };
  }
  async open(url: string) {
    if (this.closed) throw new ChannelError('mock-browser', 'Session is closed');
    if (!this.provider.lookup(url)) throw new ChannelError('mock-browser', `Page not found: ${url}`);
    this.url = url;
    return this.snapshot();
  }
  async readFields() { return this.snapshot(); }
  async fill(values: Readonly<Record<string, FieldValue>>) {
    const snap = this.snapshot();
    for (const key of Object.keys(values)) {
      if (!snap.fields.some(f => f.key === key)) throw new ChannelError('mock-browser', `Unknown field key: ${key}`);
    }
    this.values = { ...this.values, ...values };
    this.provider.recordPreview({ url: snap.url, values: { ...values } });
  }
  async upload(file: UploadFile) {
    const snap = this.snapshot();
    const field = snap.fields.find(f => f.key === file.fieldKey);
    if (!field || field.type !== 'file') throw new ChannelError('mock-browser', `Not a file field: ${file.fieldKey}`);
    this.uploads = [...this.uploads, file];
  }
  async screenshot() { this.snapshot(); return FAKE_PNG_BASE64; }
  async submit() {
    if (!this.url) throw new ChannelError('mock-browser', 'Cannot submit: session never opened a page');
    this.provider.record({ url: this.url, values: { ...this.values }, uploads: [...this.uploads], at: this.provider.clock().toISOString() });
    return { finalUrl: this.url, confirmationText: 'Thank you. Your application was received.' };
  }
  async close() { if (!this.closed) { this.closed = true; this.onClose(); } }
}

/** The offline demo's pages; the localhost page mirrors app/dev/test-application. */
export const TEST_APPLICATION_URL = 'http://localhost:3000/dev/test-application';
const f = (key: string, label: string, type: PageField['type'], required = false): PageField => ({ key, label, type, required });
export const defaultMockPages: Readonly<Record<string, MockPage>> = {
  [TEST_APPLICATION_URL]: {
    fields: [
      f('fullName', 'Full name', 'text', true), f('email', 'Email', 'email', true), f('phone', 'Phone', 'tel'),
      f('city', 'City', 'text'), f('state', 'State', 'text'), f('insurer', 'Insurer', 'text'), f('diagnosis', 'Diagnosis', 'text'),
      f('medicalHistory', 'Describe any medications you take', 'textarea'),
      f('notes', 'Anything else you want to tell us', 'textarea'),
      f('documents', 'Documents', 'file'),
      f('consentConfirm', 'I authorize this application', 'checkbox', true),
    ],
  },
};

/** WebFormChannel wired to a MockBrowserProvider, for tests and the offline demo. */
export class MockWebChannel extends WebFormChannel {
  readonly browser: MockBrowserProvider;
  constructor(opts: { pages?: Readonly<Record<string, MockPage>>; guard: ChannelGuardOptions; loadUpload?: LoadUpload; now?: () => Date }) {
    const browser = new MockBrowserProvider(opts.pages ?? defaultMockPages, opts.now);
    super({ provider: browser, guard: opts.guard, ...(opts.loadUpload ? { loadUpload: opts.loadUpload } : {}), ...(opts.now ? { now: opts.now } : {}) });
    this.browser = browser;
  }
}
