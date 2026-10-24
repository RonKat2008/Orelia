import type {
  Board,
  BoardItem,
  ConsentField,
  ConsultRequest,
  ConsultStatus,
  RequirementKind,
  RequirementStatus,
  ConsultProcess,
  PacketSection,
} from './types';

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  have: 'I have it',
  missing: 'Missing',
  patient_to_request: "I'll ask my doctor",
  unknown: 'Not checked yet',
};
export const REQUIREMENT_STATUS_ORDER: RequirementStatus[] = ['have', 'missing', 'patient_to_request'];

export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  referral_letter: 'Referral letter',
  records: 'Records',
  insurance_preauth: 'Insurance approval',
  intake_form: 'Intake form',
  econsult: 'Doctor-to-doctor e-consult',
  other: 'Other',
};

export const PROCESS_KIND_LABELS: Record<ConsultProcess['kind'], string> = {
  econsult: 'Doctor-to-doctor e-consult',
  tumor_board: 'Case conference (board review)',
  case_review: 'Case review',
  peer_to_peer: 'Doctor-to-doctor phone line',
  referral_only: 'Referral only',
  unknown: 'Process not confirmed',
};

/** Plain-language fields the patient can share, mirrors lib/outreach/draft SHARED_FIELDS. */
export const SHARE_FIELD_OPTIONS: ConsentField[] = [
  { key: 'diseaseName', label: 'Diagnosis' },
  { key: 'subtype', label: 'Subtype' },
  { key: 'stageSummary', label: 'Stage summary' },
  { key: 'homeCity', label: 'Home city' },
  { key: 'homeState', label: 'Home state' },
  { key: 'insurer', label: 'Insurance company' },
  { key: 'planId', label: 'Insurance plan' },
  { key: 'travelLimitMiles', label: 'How far you can travel' },
  { key: 'goals', label: 'Your goals' },
];

export const CONSULT_STATUS_LABELS: Record<ConsultStatus, string> = {
  drafted: 'Drafted, waiting for you',
  sent_to_doctor: 'With your doctor',
  doctor_approved: 'Your doctor approved',
  doctor_declined: 'Your doctor declined',
  ready: 'Ready to send, with your consent',
  sent: 'Sent to the expert',
  failed: 'Could not send',
  cancelled: 'Cancelled',
};

export interface TimelineStep {
  id: 'drafted' | 'sent_to_doctor' | 'doctor_decision' | 'consent' | 'sent';
  label: string;
  state: 'done' | 'current' | 'upcoming' | 'stopped';
}

/** Five-step timeline: drafted -> sent to doctor -> doctor approved/declined -> consent -> sent. */
export function consultTimeline(c: Pick<ConsultRequest, 'status' | 'doctorApprovedAt' | 'doctorDeclinedAt' | 'patientConsentAt' | 'sentAt' | 'sentToDoctorAt'>): TimelineStep[] {
  const declined = c.status === 'doctor_declined' || Boolean(c.doctorDeclinedAt);
  const approved = Boolean(c.doctorApprovedAt);
  const consented = Boolean(c.patientConsentAt);
  const sent = c.status === 'sent' || Boolean(c.sentAt);
  const toDoctor = Boolean(c.sentToDoctorAt) || approved || declined || c.status === 'sent_to_doctor';
  const flags = [true, toDoctor, approved || declined, consented, sent];
  const labels = ['Drafted', 'Sent to your doctor', declined ? 'Doctor declined' : 'Doctor approved', 'You consented', 'Sent to expert'];
  const ids: TimelineStep['id'][] = ['drafted', 'sent_to_doctor', 'doctor_decision', 'consent', 'sent'];
  const firstOpen = flags.findIndex(f => !f);
  return ids.map((id, i) => {
    let state: TimelineStep['state'];
    if (flags[i]) state = id === 'doctor_decision' && declined ? 'stopped' : 'done';
    else if (declined || c.status === 'cancelled') state = 'upcoming';
    else state = i === firstOpen ? 'current' : 'upcoming';
    return { id, label: labels[i], state };
  });
}

/** Shown wherever an unverified doctor appears (security review #1). */
export const UNVERIFIED_DOCTOR_NOTE = 'Doctor not verified — request will be checked by the standard filter.';

const REFUSAL_COPY: Record<string, string> = {
  // consult gate (lib/safety/consult-gate.ts)
  no_doctor_approval: 'Your doctor has not approved this request yet.',
  consult_not_ready: 'This request is not ready to send yet. Your doctor needs to approve it and you need to confirm.',
  no_patient_consent: 'You have not given your consent yet.',
  consent_before_doctor_approval: 'Your consent was recorded before your doctor approved, so please confirm again.',
  text_changed_after_approval: 'The text changed after your doctor approved it, so it needs their approval again.',
  no_expert_address: 'We could not find a verified clinician address for this expert, so nothing can be sent.',
  address_not_evidence_backed: 'We could not find a verified clinician address for this expert, so nothing can be sent.',
  control_characters: 'The subject or message contains characters that cannot be sent in an email.',
  approval_not_verified: 'We could not confirm your doctor\'s approval of this exact request and address, so it needs their approval again.',
  doctor_email_not_allowed: 'Use your doctor\'s own practice email, not yours or a Wayfinder address.',
  rate_limited: 'Too many review emails were sent today. Try again tomorrow.',
  // outbound gate (lib/safety/outbound-gate.ts)
  not_approved: 'This message has not been approved yet.',
  not_allowlisted: 'This address is not on the list of addresses allowed for this environment.',
  contact_cap: 'You already have five active contacts. Close one before reaching out to another.',
  follow_up_cadence: 'It is too soon to write to this contact again.',
  unshared_field: 'The message includes a detail you did not choose to share.',
  missing_disclosure: 'The AI-drafted notice is missing from the message.',
  medical_advice: 'The message reads like medical advice, which Wayfinder cannot send.',
  invalid_draft: 'The message or address is not valid.',
  consent_mismatch: 'Your sharing choices changed, so please review the request again.',
  inactive_contact: 'This contact is closed, so nothing can be sent.',
  doctor_email_failed: 'The email to your doctor could not be sent. Try again.',
  send_failed: 'The email could not be sent. It was not retried automatically, so nothing went out twice.',
};

/** Plain-language refusal reasons; unknown codes get a generic line (never raw codes). */
export function refusalMessages(reasons: readonly string[] | undefined): string[] {
  if (!reasons?.length) return [];
  const out = reasons.map(r => REFUSAL_COPY[r] ?? 'A safety check stopped this, so nothing was sent.');
  return [...new Set(out)];
}

export type PatientAction = 'edit' | 'send_to_doctor' | 'consent' | 'send' | 'cancel';

/** Which actions the patient can take now. */
export function availableActions(status: ConsultStatus): PatientAction[] {
  switch (status) {
    case 'drafted': return ['edit', 'send_to_doctor', 'cancel'];
    case 'sent_to_doctor': return ['send_to_doctor', 'cancel'];
    case 'doctor_approved': return ['consent', 'cancel'];
    case 'ready': return ['send', 'cancel'];
    case 'failed': return ['cancel'];
    case 'doctor_declined': return ['cancel'];
    default: return [];
  }
}

export const BOARD_STATUS_LABELS: Record<BoardItem['status'], string> = {
  done: 'Done',
  pending: 'To do',
  waiting: 'Waiting',
  blocked: 'Needs attention',
};
export const BOARD_STATUS_TONE: Record<BoardItem['status'], 'ok' | 'teal' | 'gold' | 'warn'> = {
  done: 'ok',
  pending: 'teal',
  waiting: 'gold',
  blocked: 'warn',
};

export type BoardGroupKey = 'patient' | 'doctor' | 'resource';
export const BOARD_GROUP_TITLES: Record<BoardGroupKey, string> = {
  patient: 'You',
  doctor: 'Your doctors',
  resource: 'Hospitals and specialists',
};
export interface BoardGroup { key: BoardGroupKey; title: string; items: BoardItem[] }

const STATUS_RANK: Record<BoardItem['status'], number> = { blocked: 0, pending: 1, waiting: 2, done: 3 };

/** Group by owner; within a group open items first, then by due date (undated last). Empty groups are dropped. */
export function groupBoard(board: Pick<Board, 'items'> | null): BoardGroup[] {
  if (!board) return [];
  const keys: BoardGroupKey[] = ['patient', 'doctor', 'resource'];
  return keys
    .map(key => ({
      key,
      title: BOARD_GROUP_TITLES[key],
      items: board.items
        .filter(i => i.owner.kind === key)
        .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || dueValue(a.due) - dueValue(b.due)),
    }))
    .filter(g => g.items.length > 0);
}
function dueValue(due: string | null): number {
  if (!due) return Number.POSITIVE_INFINITY;
  const t = Date.parse(due);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function formatDue(due: string | null, now: Date = new Date()): string | null {
  if (!due) return null;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return null;
  const date = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return t < now.getTime() ? `Was due ${date}` : `Due ${date}`;
}

export function includedSections(sections: readonly PacketSection[]): PacketSection[] {
  return sections.filter(s => s.included);
}

export function checklistProgress(statuses: readonly RequirementStatus[]): { have: number; total: number } {
  return { have: statuses.filter(s => s === 'have').length, total: statuses.length };
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Resource keys contain a colon; encode for URL path/query use. */
export const encodeKey = (key: string) => encodeURIComponent(key);
