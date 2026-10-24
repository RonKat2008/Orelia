import { assertGated, ChannelError, type Channel, type ChannelGuardOptions, type GatedDraft, type ProviderRef } from './types';
import { checkWebUrl } from './web-url-check';
import { fingerprintFields, type BrowserProvider, type BrowserSession, type FieldValue, type PageSnapshot } from './browser-types';

export type LoadUpload = (docId: string) => Promise<{ name: string; mimeType: string; content: Uint8Array }>;

/** The live form no longer matches the one the patient approved; nothing was submitted. */
export class PageChangedError extends ChannelError {
  constructor(provider: BrowserProvider['name']) {
    super(provider, 'page_changed', undefined, false);
    this.name = 'PageChangedError';
  }
}

export interface WebFormChannelOptions {
  provider: BrowserProvider;
  guard: ChannelGuardOptions;
  loadUpload?: LoadUpload;
  now?: () => Date;
}

/**
 * Fills online application forms. Submit is reachable only through send(gated); readForm/fillPreview never submit.
 * Page text is untrusted: adapters sanitize labels/options before they reach this class.
 */
export class WebFormChannel implements Channel {
  readonly kind = 'web_form' as const;
  protected readonly provider: BrowserProvider;
  private readonly guard: ChannelGuardOptions;
  private readonly loadUpload?: LoadUpload;

  constructor(opts: WebFormChannelOptions) {
    this.provider = opts.provider; this.guard = opts.guard;
    if (opts.loadUpload) this.loadUpload = opts.loadUpload;
  }

  get providerName() { return this.provider.name; }
  get status() { return this.provider.status; }

  async send(gated: GatedDraft): Promise<ProviderRef> {
    const name = this.provider.name;
    const url = assertGated(gated, 'web_form', name, this.guard);
    const form = gated.webForm;
    if (!form) throw new ChannelError(name, 'Refusing web_form payload without form data');
    if (form.uploads.length > 0 && !this.loadUpload) throw new ChannelError(name, 'No upload loader configured for document uploads');

    const session = await this.provider.launch();
    try {
      const live = await session.open(url);
      if (fingerprintFields(live.fields) !== form.formFingerprint) throw new PageChangedError(name);
      const values: Record<string, FieldValue> = {};
      for (const f of form.fields) values[f.fieldKey] = f.value;
      await session.fill(values);
      for (const up of form.uploads) {
        const file = await this.loadUpload!(up.docId); // only injected loader; never arbitrary paths
        if (!file) throw new ChannelError(name, `Upload document not available: ${up.docId}`);
        await session.upload({ fieldKey: up.fieldKey, name: file.name, mimeType: file.mimeType, content: file.content });
      }
      await session.submit();
      return { provider: name, channel: 'web_form', status: 'submitted' };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  /** Open the URL and read its form fields. Never fills or submits. */
  async readForm(url: string): Promise<PageSnapshot> {
    return this.withSession(url, async (_s, snap) => snap);
  }

  /** Fill (never submit) and screenshot, so the patient can review what would be sent. */
  async fillPreview(url: string, values: Record<string, FieldValue>): Promise<{ snapshot: PageSnapshot; screenshot: string }> {
    return this.withSession(url, async (s) => {
      await s.fill(values);
      const screenshot = await s.screenshot();
      return { snapshot: await s.readFields(), screenshot };
    });
  }

  private async withSession<T>(url: string, run: (s: BrowserSession, snap: PageSnapshot) => Promise<T>): Promise<T> {
    const name = this.provider.name;
    checkWebUrl(url, name, this.guard); // previews are limited to the web allowlist too
    const session = await this.provider.launch();
    try {
      const snap = await session.open(url);
      return await run(session, snap);
    } finally {
      await session.close().catch(() => undefined);
    }
  }
}
