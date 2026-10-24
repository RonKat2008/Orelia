/**
 * Kernel cloud-browser adapter for the web_form channel, plus the typed API the contact planner calls.
 *
 *   probeApplicationForm(channel, url)      -> { url, hasForm, fields, formFingerprint }   read-only, never fills or submits
 *   draftFillWebForm(channel, input)        -> { fields, missing, screenshot, safetyDraft } fills (never submits) and screenshots
 *   submitGatedWebForm(channel, gated)      -> ProviderRef                                  the ONLY submit path
 *
 * Flow: probe -> draftFillWebForm -> patient reviews + approves -> checkOutbound({draft: safetyDraft + approvedAt, ...})
 * yields a GatedDraft -> submitGatedWebForm. Safeguards: URLs must be on OUTBOUND_WEB_ALLOWLIST (probe/draft too);
 * only consent-ticked fields and doc snippets are used; medical questions, checkboxes and files are never auto-answered;
 * the AI disclosure is code-composed; submit refuses if the live form no longer matches the reviewed fingerprint.
 * Page text is untrusted and sanitized. With no KERNEL_API_KEY the channel is 'unconfigured' and nothing touches the network.
 * Build the channel with createKernelWebChannel({ apiKey, guard }) (or selectWebChannel in lib/outreach/channel-wiring).
 */
import { mapFormFields, type MapFormFieldsInput, type MapFormFieldsResult } from '../agents/form-mapper';
import type { SafetyDraft } from '../safety/types';
import { cleanConfirmation, cleanLabel, cleanOptions } from './page-text';
import { fingerprintFields, type BrowserProvider, type BrowserSession, type FieldValue, PageField, PageFieldType, PageSnapshot, UploadFile } from './browser-types';
import { ChannelError, type ChannelGuardOptions, type GatedDraft, type ProviderRef } from './types';
import { WebFormChannel, type LoadUpload } from './web-form';

/** Minimal slices of @onkernel/sdk and playwright-core, so tests inject fakes and nothing needs the network. */
export interface KernelClientLike {
  browsers: {
    create(body?: { timeout_seconds?: number }): Promise<{ cdp_ws_url: string; session_id: string }>;
    deleteByID(idOrName: string): Promise<void>;
  };
}
export interface LocatorLike {
  fill(value: string): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  selectOption(value: { label: string } | string): Promise<unknown>;
  setInputFiles(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
  click(): Promise<void>;
  first(): LocatorLike;
}
export interface PageLike {
  goto(url: string, opts?: { waitUntil?: 'load' }): Promise<unknown>;
  evaluate<R>(fn: string | ((...args: never[]) => R), arg?: unknown): Promise<R>;
  locator(selector: string): LocatorLike;
  screenshot(opts?: { type?: 'png' }): Promise<Buffer>;
  url(): string;
  waitForLoadState(state?: 'load'): Promise<void>;
}
export interface PlaywrightBrowserLike {
  contexts(): { pages(): PageLike[]; newPage(): Promise<PageLike> }[];
  newContext(): Promise<{ newPage(): Promise<PageLike> }>;
  close(): Promise<void>;
}
export type ConnectCdp = (cdpUrl: string) => Promise<PlaywrightBrowserLike>;

export interface KernelBrowserOptions { apiKey?: string; client?: KernelClientLike; connect?: ConnectCdp }

/** Keep cloud sessions short-lived; Kernel reaps them even if our cleanup fails. */
export const KERNEL_SESSION_TIMEOUT_SECONDS = 120;

interface RawField { index: number; tag: string; type: string; name: string; id: string; label: string; required: boolean; options: string[]; optionIndexes: number[] }

/** Runs inside the page: tags each control with data-wf-i and returns raw (untrusted) descriptors. */
function collectFieldsInPage(): RawField[] {
  const ignored = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const out: RawField[] = [];
  const labelFor = (el: Element): string => {
    const id = el.getAttribute('id');
    const byFor = id ? document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`) : null;
    const wrap = el.closest('label');
    return (byFor?.textContent || wrap?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
  };
  const byRadioName = new Map<string, RawField>();
  let n = 0;
  document.querySelectorAll('input, select, textarea').forEach((node) => {
    const el = node as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
    if (ignored.has(type)) return;
    el.setAttribute('data-wf-i', String(n));
    const base = { index: n, tag, type, name: el.getAttribute('name') || '', id: el.getAttribute('id') || '', label: labelFor(el), required: el.hasAttribute('required') };
    n++;
    if (type === 'radio' && base.name) {
      const group = byRadioName.get(base.name);
      if (group) { group.options.push(base.label); group.optionIndexes.push(base.index); if (base.required) group.required = true; return; }
      const raw = { ...base, label: '', options: [base.label], optionIndexes: [base.index] };
      byRadioName.set(base.name, raw); out.push(raw); return;
    }
    const options = tag === 'select' ? Array.from((el as unknown as HTMLSelectElement).options).map(o => (o.textContent || '').trim()) : [];
    out.push({ ...base, options, optionIndexes: [] });
  });
  // A radio group's own label is the legend/fieldset text when present.
  byRadioName.forEach((raw, name) => {
    const first = document.querySelector(`input[type=radio][name="${name.replace(/"/g, '\\"')}"]`);
    raw.label = (first?.closest('fieldset')?.querySelector('legend')?.textContent || name).trim();
  });
  return out;
}

/** Serialized for the page; the shim covers esbuild/tsx `keepNames` helpers that do not exist in the browser. */
const COLLECT_FIELDS_SCRIPT = `(() => { var __name = (f) => f; return (${collectFieldsInPage.toString()})(); })()`;

const KNOWN_TYPES = new Set<PageFieldType>(['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'checkbox', 'radio', 'file']);
const toType = (t: string): PageFieldType => (t === 'select-one' ? 'select' : KNOWN_TYPES.has(t as PageFieldType) ? (t as PageFieldType) : 'other');

interface FieldTarget { index: number; type: PageFieldType; optionIndexes: number[]; options: string[] }

class KernelSession implements BrowserSession {
  private targets = new Map<string, FieldTarget>();
  private closed = false;
  constructor(private page: PageLike, private browser: PlaywrightBrowserLike, private cleanup: () => Promise<void>) {}

  private byIndex(i: number) { return this.page.locator(`[data-wf-i="${i}"]`).first(); }

  async open(url: string): Promise<PageSnapshot> {
    await this.page.goto(url, { waitUntil: 'load' });
    return this.readFields();
  }

  async readFields(): Promise<PageSnapshot> {
    const raw = await this.page.evaluate<RawField[]>(COLLECT_FIELDS_SCRIPT);
    this.targets = new Map();
    const fields: PageField[] = raw.map(r => {
      const baseKey = cleanLabel(r.name || r.id) || `field-${r.index}`;
      let key = baseKey; let dup = 1;
      while (this.targets.has(key)) key = `${baseKey}-${++dup}`;
      const type = toType(r.type);
      this.targets.set(key, { index: r.index, type, optionIndexes: r.optionIndexes, options: r.options });
      const options = type === 'select' || type === 'radio' ? cleanOptions(r.options) : undefined;
      return { key, label: cleanLabel(r.label), type, required: r.required, ...(options ? { options } : {}) };
    });
    return { url: this.page.url(), fields };
  }

  private target(key: string): FieldTarget {
    const t = this.targets.get(key);
    if (!t) throw new ChannelError('kernel', `Unknown field key: ${key}`);
    return t;
  }

  async fill(values: Readonly<Record<string, FieldValue>>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      const t = this.target(key);
      if (t.type === 'file') throw new ChannelError('kernel', `Use upload() for file field: ${key}`);
      if (t.type === 'checkbox') {
        const loc = this.byIndex(t.index);
        if (value === true || value === 'true') await loc.check(); else await loc.uncheck();
      } else if (t.type === 'radio') {
        const pos = t.options.findIndex(o => cleanLabel(o) === String(value) || o === String(value));
        const idx = t.optionIndexes[pos];
        if (pos < 0 || idx === undefined) throw new ChannelError('kernel', `Unknown option for ${key}`);
        await this.byIndex(idx).check();
      } else if (t.type === 'select') {
        await this.byIndex(t.index).selectOption({ label: String(value) });
      } else {
        await this.byIndex(t.index).fill(String(value));
      }
    }
  }

  async upload(file: UploadFile): Promise<void> {
    const t = this.target(file.fieldKey);
    if (t.type !== 'file') throw new ChannelError('kernel', `Not a file field: ${file.fieldKey}`);
    await this.byIndex(t.index).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.content) });
  }

  async screenshot(): Promise<string> { return (await this.page.screenshot({ type: 'png' })).toString('base64'); }

  async submit() {
    await this.page.locator('form [type=submit], form button:not([type]), [type=submit]').first().click();
    await this.page.waitForLoadState('load');
    const text = await this.page.evaluate(() => (document.body?.innerText ?? ''));
    const confirmationText = cleanConfirmation(text);
    return { finalUrl: this.page.url(), ...(confirmationText ? { confirmationText } : {}) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await this.browser.close(); } catch { /* cleanup never throws */ }
    finally { try { await this.cleanup(); } catch { /* cleanup never throws */ } }
  }
}

export class KernelBrowserProvider implements BrowserProvider {
  readonly name = 'kernel' as const;
  readonly status: 'ready' | 'unconfigured';
  private readonly apiKey?: string;
  private readonly client?: KernelClientLike;
  private readonly connect?: ConnectCdp;

  constructor(opts: KernelBrowserOptions = {}) {
    const key = opts.apiKey?.trim();
    this.status = key ? 'ready' : 'unconfigured';
    if (key) this.apiKey = key;
    if (opts.client) this.client = opts.client;
    if (opts.connect) this.connect = opts.connect;
  }

  private async getClient(): Promise<KernelClientLike> {
    if (this.client) return this.client;
    const { default: Kernel } = await import('@onkernel/sdk');
    return new Kernel({ apiKey: this.apiKey! }) as unknown as KernelClientLike;
  }

  private async getConnect(): Promise<ConnectCdp> {
    if (this.connect) return this.connect;
    const { chromium } = await import('playwright-core');
    return (url) => chromium.connectOverCDP(url) as unknown as Promise<PlaywrightBrowserLike>;
  }

  async launch(): Promise<BrowserSession> {
    if (this.status !== 'ready') throw new ChannelError('kernel', 'Kernel is not configured (KERNEL_API_KEY missing)');
    const client = await this.getClient();
    const created = await client.browsers.create({ timeout_seconds: KERNEL_SESSION_TIMEOUT_SECONDS });
    const cleanup = async () => { await client.browsers.deleteByID(created.session_id); };
    let browser: PlaywrightBrowserLike | undefined;
    try {
      browser = await (await this.getConnect())(created.cdp_ws_url);
      const ctx = browser.contexts()[0];
      const page = ctx?.pages()[0] ?? (ctx ? await ctx.newPage() : await (await browser.newContext()).newPage());
      return new KernelSession(page, browser, cleanup);
    } catch (error) {
      try { await browser?.close(); } catch { /* ignore */ }
      try { await cleanup(); } catch { /* ignore */ }
      throw new ChannelError('kernel', `Could not start a browser session: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}

export function createKernelWebChannel(opts: { apiKey?: string; guard: ChannelGuardOptions; loadUpload?: LoadUpload } & Pick<KernelBrowserOptions, 'client' | 'connect'>): WebFormChannel {
  return new WebFormChannel({
    provider: new KernelBrowserProvider({
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      ...(opts.client ? { client: opts.client } : {}), ...(opts.connect ? { connect: opts.connect } : {}),
    }),
    guard: opts.guard, ...(opts.loadUpload ? { loadUpload: opts.loadUpload } : {}),
  });
}
export { createKernelWebChannel as KernelWebChannel };

// ---------------------------------------------------------------------------
// Typed API for the contact planner
// ---------------------------------------------------------------------------

export interface ProbeResult {
  readonly url: string;
  /** True when the page exposes at least one fillable control. */
  readonly hasForm: boolean;
  readonly fields: PageSnapshot['fields'];
  /** fingerprintFields() of the page; drafts record it so submit can detect a changed form. */
  readonly formFingerprint: string;
}

/** Open `url` (must be on the web allowlist) and report its form fields. Never fills or submits. */
export async function probeApplicationForm(channel: WebFormChannel, url: string): Promise<ProbeResult> {
  const snap = await channel.readForm(url);
  return { url: snap.url, hasForm: snap.fields.length > 0, fields: snap.fields, formFingerprint: fingerprintFields(snap.fields) };
}

export type DraftFillInput = Omit<MapFormFieldsInput, 'fields'> & { url: string };

export interface DraftFillResult extends MapFormFieldsResult {
  readonly url: string;
  readonly formFingerprint: string;
  /** base64 PNG of the filled (unsubmitted) page, for the patient to review. */
  readonly screenshot: string;
  /** Pass to checkOutbound after the patient sets approvedAt and ticks sharedDocIds. */
  readonly safetyDraft: SafetyDraft;
}

/** Read the form, map fields from consented data only, fill them in a throwaway browser and screenshot. Never submits. */
export async function draftFillWebForm(channel: WebFormChannel, input: DraftFillInput): Promise<DraftFillResult> {
  const { url, ...mapInput } = input;
  const probe = await probeApplicationForm(channel, url);
  if (!probe.hasForm) throw new ChannelError(channel.providerName, 'No application form found at this URL');
  const mapped = await mapFormFields({ ...mapInput, fields: probe.fields });
  const values: Record<string, FieldValue> = {};
  for (const f of mapped.filled) values[f.fieldKey] = f.value;
  const { snapshot, screenshot } = await channel.fillPreview(url, values);
  const formFingerprint = fingerprintFields(snapshot.fields);
  const safetyDraft: SafetyDraft = {
    channel: 'web_form', address: url,
    body: `Application form at ${url}: ${mapped.filled.map(f => f.label || f.fieldKey).join(', ')}`,
    ...(input.contactId ? { contactId: input.contactId } : {}), caseId: input.caseId,
    webForm: {
      formFingerprint, fields: mapped.filled, uploads: [],
      hasFreeText: probe.fields.some(f => f.type === 'textarea'),
    },
  };
  return { ...mapped, url, formFingerprint, screenshot, safetyDraft };
}

/** Submit a draft that passed checkOutbound. Refuses forged drafts, off-allowlist hosts and changed forms. */
export function submitGatedWebForm(channel: WebFormChannel, gated: GatedDraft): Promise<ProviderRef> {
  return channel.send(gated);
}

/** Short names used by the brief / planner. */
export { probeApplicationForm as probeForm, draftFillWebForm as draftFill, submitGatedWebForm as submitGated };
