/**
 * Web-form channel port for contact-plan execution. Shape: probe the form, draft a fill from the patient's TICKED
 * fields only, submit only a GatedDraft produced by checkOutbound (same unforgeable payload the email/voice adapters
 * require). The default implementation never touches the network and answers 'not_available'; a Kernel
 * (cloud-browser) implementation can be injected later without changing the executor.
 */
import type { GatedDraft } from '../safety/outbound-gate';

export interface FormField {
  name: string;
  label: string;
  required: boolean;
}

export type NotAvailable = { ok: false; status: 'not_available'; reason: string };

export type ProbeResult = { ok: true; url: string; fields: FormField[] } | NotAvailable;

export interface FormFillDraft {
  url: string;
  /** field name -> value; only fields the patient consented to share. */
  values: Readonly<Record<string, string>>;
}
export type DraftFillResult = { ok: true; draft: FormFillDraft } | NotAvailable;

export type SubmitResult = { ok: true; status: 'submitted'; confirmationRef?: string } | NotAvailable;

export interface WebFormChannel {
  probeForm(url: string): Promise<ProbeResult>;
  draftFill(input: { url: string; fields: FormField[]; sharedValues: Readonly<Record<string, string>> }): Promise<DraftFillResult>;
  /** Accepts only a gated payload; a raw draft does not type-check. */
  submitGated(gated: GatedDraft, fill: FormFillDraft): Promise<SubmitResult>;
}

const unavailable = (reason: string): NotAvailable => ({ ok: false, status: 'not_available', reason });

/** No browser automation is configured: every call reports 'not_available' and performs no I/O. */
export class UnavailableWebFormChannel implements WebFormChannel {
  constructor(private readonly reason = 'Online form submission is not available in this environment') {}
  async probeForm(): Promise<ProbeResult> { return unavailable(this.reason); }
  async draftFill(): Promise<DraftFillResult> { return unavailable(this.reason); }
  async submitGated(): Promise<SubmitResult> { return unavailable(this.reason); }
}

const g = globalThis as unknown as { __wayfinderWebFormChannel?: WebFormChannel };

export function getWebFormChannel(): WebFormChannel {
  g.__wayfinderWebFormChannel ??= new UnavailableWebFormChannel();
  return g.__wayfinderWebFormChannel;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setWebFormChannelForTests(channel: WebFormChannel | undefined): void {
  if (channel) g.__wayfinderWebFormChannel = channel;
  else delete g.__wayfinderWebFormChannel;
}
