import { neutralizeUntrusted } from '../agents/research/untrusted';
import { extractProposal } from './extract';
import { KIND_LABELS, DEFAULT_REMINDERS, type Appointment } from './schema';
import type { AppointmentStore } from './store';
import { resolveTimeZone } from './timezone';

/**
 * Inbound reply / call transcript -> a *proposed* appointment the patient confirms. Never confirms, never sends,
 * never touches a calendar. Idempotent per inbound event (case_id + source_message_id is unique).
 */
export interface CaptureEvent {
  channel: 'email' | 'voice';
  caseId: string;
  contactId: string;
  body: string;
  /** Provider message id or call id. */
  providerId: string;
  receivedAt?: string;
}

export interface CaptureContext {
  resourceName: string;
  /** "City, ST" or a bare state code, when known. */
  resourceAddress?: string;
  homeState?: string | null;
}

export interface CaptureDeps {
  store: AppointmentStore;
  loadContext(contactId: string): Promise<CaptureContext>;
  now?: () => Date;
}

export function stateFromAddress(address: string | undefined): string | null {
  const m = address?.trim().match(/(?:^|,\s*|\s)([A-Z]{2})$/);
  return m ? m[1] : null;
}

export function captureSourceId(e: Pick<CaptureEvent, 'channel' | 'providerId'>): string {
  return `${e.channel}:${e.providerId}`;
}

export async function captureAppointment(e: CaptureEvent, deps: CaptureDeps): Promise<{ appointment: Appointment; created: boolean } | null> {
  const receivedAt = e.receivedAt ? new Date(e.receivedAt) : (deps.now?.() ?? new Date());
  const ctx = await deps.loadContext(e.contactId);
  const defaultTimeZone = resolveTimeZone({ resourceState: stateFromAddress(ctx.resourceAddress), homeState: ctx.homeState });
  const proposal = extractProposal(e.body, { receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt, defaultTimeZone });
  if (!proposal) return null;
  const first = proposal.candidates[0];
  const resource = neutralizeUntrusted(ctx.resourceName).slice(0, 120) || 'the office';
  const owner = await deps.store.caseOwner(e.caseId);
  return deps.store.insert({
    caseId: e.caseId,
    ownerKey: owner ?? null,
    contactId: e.contactId,
    kind: proposal.kind,
    title: `${KIND_LABELS[proposal.kind]} with ${resource}`,
    // The first candidate is pre-filled for display only; status stays proposed until the patient confirms.
    startsAt: first.startsAt,
    endsAt: first.endsAt,
    timezone: proposal.timezone,
    location: proposal.location ?? null,
    telehealthUrl: proposal.telehealthUrl ?? null,
    phone: proposal.phone ?? null,
    withWhom: resource,
    status: 'proposed',
    source: e.channel === 'voice' ? 'call_transcript' : 'reply',
    sourceMessageId: captureSourceId(e),
    candidates: proposal.candidates,
    quote: proposal.quote,
    prepNotes: { checked: {}, questions: [], note: '' },
    reminders: [...DEFAULT_REMINDERS],
  });
}
