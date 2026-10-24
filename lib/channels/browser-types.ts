/** Browser abstraction shared by the Kernel adapter and the offline mock. Page text is untrusted data. */

export type PageFieldType =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'other';

/** One form control as read from the page; labels/options are already passed through the untrusted-text sanitizer. */
export interface PageField {
  /** Stable key for this control on this page (form `name`, else `id`, else positional); used to fill it. */
  readonly key: string;
  readonly label: string;
  readonly type: PageFieldType;
  readonly required: boolean;
  readonly options?: readonly string[];
}

export type FieldValue = string | boolean;

export interface PageSnapshot {
  readonly url: string;
  readonly fields: readonly PageField[];
}

export interface UploadFile {
  readonly fieldKey: string;
  readonly name: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface BrowserSession {
  open(url: string): Promise<PageSnapshot>;
  /** Re-read the live page's fields (used to verify the page still matches an approved draft). */
  readFields(): Promise<PageSnapshot>;
  /** Fill by field key. Unknown keys throw; nothing is submitted. */
  fill(values: Readonly<Record<string, FieldValue>>): Promise<void>;
  upload(file: UploadFile): Promise<void>;
  /** PNG, base64 encoded (no data: prefix). */
  screenshot(): Promise<string>;
  /** Clicks the form's submit control. Only WebFormChannel.send may call this. */
  submit(): Promise<{ finalUrl: string; confirmationText?: string }>;
  close(): Promise<void>;
}

export interface BrowserProvider {
  readonly name: 'kernel' | 'mock-browser';
  /** 'unconfigured' when credentials are missing; launch() then throws ChannelError and never touches the network. */
  readonly status: 'ready' | 'unconfigured';
  launch(): Promise<BrowserSession>;
}

/** Stable digest of the structure of a form (keys, types, required flags, options), independent of values. */
export function fingerprintFields(fields: readonly PageField[]): string {
  const canonical = JSON.stringify(
    [...fields].map(f => [f.key, f.type, f.required, f.label, f.options ?? []]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) hash = ((hash * 33) ^ canonical.charCodeAt(i)) >>> 0;
  return `f1-${hash.toString(16)}-${canonical.length}`;
}
