import { formatInZone } from './timezone';
import { KIND_LABELS, type Appointment } from './schema';
import { getAppointmentStore, type AppointmentStore } from './store';

/**
 * Server-side summary for the patient case home ("live status line" and "What's happened"). Callers must already
 * have authorized the viewer for the case (guardCase / requireCaseOwner). The UI counterpart is
 * components/appointments/UpcomingAppointments (pass caseId).
 */
export interface AppointmentSummaryItem {
  id: string;
  kind: Appointment['kind'];
  kindLabel: string;
  title: string;
  status: Appointment['status'];
  startsAt: string | null;
  whenText: string | null;
  href: string;
  at: string;
}

export interface CaseAppointmentSummary {
  /** One sentence for the status line, or null when nothing is scheduled or proposed. */
  statusLine: string | null;
  next: AppointmentSummaryItem | null;
  proposedCount: number;
  /** Newest first: proposed, confirmed, cancelled and done events for a "What's happened" list. */
  events: AppointmentSummaryItem[];
}

function item(a: Appointment): AppointmentSummaryItem {
  return {
    id: a.id, kind: a.kind, kindLabel: KIND_LABELS[a.kind], title: a.title, status: a.status, startsAt: a.startsAt,
    whenText: a.startsAt ? formatInZone(a.startsAt, a.timezone) : null, href: `/cases/${a.caseId}/appointments`, at: a.updatedAt,
  };
}

export function summarizeAppointments(list: Appointment[], now: Date = new Date()): CaseAppointmentSummary {
  const upcoming = list.filter(a => a.status === 'confirmed' && a.startsAt && new Date(a.startsAt) > now).sort((x, y) => x.startsAt!.localeCompare(y.startsAt!));
  const proposed = list.filter(a => a.status === 'proposed');
  const next = upcoming[0] ? item(upcoming[0]) : null;
  const statusLine = next
    ? `Next: ${next.kindLabel.toLowerCase()} ${next.whenText}${proposed.length ? `; ${proposed.length} proposed time${proposed.length === 1 ? '' : 's'} to confirm` : ''}.`
    : proposed.length ? `${proposed.length === 1 ? 'An office proposed a time' : `${proposed.length} proposed times`} for you to confirm.` : null;
  const events = [...list].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).map(item);
  return { statusLine, next, proposedCount: proposed.length, events };
}

export async function caseAppointmentSummary(caseId: string, store: AppointmentStore = getAppointmentStore(), now: Date = new Date()): Promise<CaseAppointmentSummary> {
  return summarizeAppointments(await store.listForCase(caseId), now);
}
