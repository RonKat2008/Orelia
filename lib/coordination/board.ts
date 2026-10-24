/**
 * Next-steps board: a coordination view derived on every read (never stored) from requirement checklists, consult
 * requests, outreach contacts and open tasks. Each item says who holds the ball.
 */
import type { Board, BoardItem, ConsultRequest, CoordinationStore, ReferralRequirement } from './contract';

export interface BoardContact { id: string; resourceKey: string; state: string; nextFollowUpAt: string | null }
export interface BoardTask { id: string; title: string | null; kind: string; status: 'open' | 'approved' | 'done'; dueAt: string | null; resourceKey: string | null }

export interface BoardDeps {
  store: CoordinationStore;
  now(): Date;
  /** resourceKey -> display name (selected resources). Unknown keys fall back to a generic label. */
  names(caseId: string): Promise<Record<string, string>>;
  contacts(caseId: string): Promise<BoardContact[]>;
  tasks(caseId: string): Promise<BoardTask[]>;
}

const RANK = { blocked: 0, pending: 1, waiting: 2, done: 3 } as const;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const REQ_DETAIL: Partial<Record<ReferralRequirement['status'], string>> = { missing: 'Not found in your records yet', patient_to_request: 'You plan to request this', have: 'Found in your records' };

export async function buildBoard(caseId: string, deps: BoardDeps): Promise<Board> {
  const [checklists, consults, doctors, names, contacts, tasks] = await Promise.all([
    deps.store.list(caseId, 'checklist'), deps.store.list(caseId, 'consult'), deps.store.list(caseId, 'doctor'),
    deps.names(caseId), deps.contacts(caseId), deps.tasks(caseId),
  ]);
  const nameOf = (key: string | null) => (key && names[key]) || 'this resource';
  const doctorName = new Map(doctors.map(d => [d.id, d.name]));
  const coordinate = `/cases/${caseId}/coordinate`;
  const items: BoardItem[] = [];

  for (const list of checklists) {
    for (const r of list.requirements) {
      const detail = REQ_DETAIL[r.status];
      if (!detail) continue;
      items.push({
        id: `requirement:${list.resourceKey}:${r.id}`, owner: { kind: 'patient', name: 'You' }, title: clip(r.label, 200),
        detail: clip(`${nameOf(list.resourceKey)}: ${detail}`, 600), status: r.status === 'have' ? 'done' : 'pending', due: null,
        resourceKey: list.resourceKey, origin: 'requirement', href: coordinate, sourceUrl: r.sourceUrl,
      });
    }
  }

  for (const c of consults) {
    const item = consultItem(c, doctorName.get(c.doctorId) ?? 'Your doctor', coordinate);
    if (item) items.push(item);
  }

  for (const c of contacts) items.push(contactItem(c, nameOf(c.resourceKey), `/cases/${caseId}/tracker`));
  for (const t of tasks) items.push(taskItem(t, nameOf(t.resourceKey), `/cases/${caseId}/threads`));

  items.sort(compare);
  return { caseId, items, generatedAt: deps.now().toISOString() };
}

function consultItem(c: ConsultRequest, doctor: string, href: string): BoardItem | null {
  const base = { id: `consult:${c.id}`, resourceKey: c.resourceKey, origin: 'consult' as const, href, sourceUrl: c.process.sourceUrl, due: null as string | null };
  const patient = { kind: 'patient' as const, name: 'You' };
  const title = (t: string) => clip(t, 200);
  switch (c.status) {
    case 'drafted': return { ...base, owner: patient, title: title(`Review the consultation request to ${c.expertName}`), detail: 'Drafted for your doctor to review before anything is sent', status: 'pending' };
    case 'doctor_approved': return { ...base, owner: patient, title: title(`Give your consent to send ${doctor}'s approved request to ${c.expertName}`), detail: null, status: 'pending' };
    case 'ready': return { ...base, owner: patient, title: title(`Send the approved request to ${c.expertName}`), detail: 'Your doctor approved and you consented', status: 'pending' };
    case 'sent_to_doctor': return { ...base, owner: { kind: 'doctor', name: doctor }, title: title(`${doctor} is reviewing the request to ${c.expertName}`), detail: 'Review link sent', status: 'waiting', due: c.reviewTokenExpiresAt };
    case 'sent': return { ...base, owner: { kind: 'resource', name: c.expertName }, title: title(`Waiting for ${c.expertName} to respond to the consultation request`), detail: null, status: 'waiting' };
    case 'doctor_declined': return { ...base, owner: patient, title: title(`${doctor} declined the request to ${c.expertName}`), detail: c.doctorNote, status: 'blocked' };
    case 'failed': return { ...base, owner: patient, title: title(`The consultation request to ${c.expertName} could not be sent`), detail: null, status: 'blocked' };
    case 'cancelled': return null;
  }
}

const CONTACT_STATE: Record<string, { owner: 'patient' | 'resource'; status: BoardItem['status']; title: (n: string) => string }> = {
  drafted: { owner: 'patient', status: 'pending', title: n => `Review and approve the message to ${n}` },
  sent: { owner: 'resource', status: 'waiting', title: n => `Waiting for a reply from ${n}` },
  records_sent: { owner: 'resource', status: 'waiting', title: n => `Records sent to ${n}; waiting to hear back` },
  replied: { owner: 'patient', status: 'pending', title: n => `Read the reply from ${n}` },
  task_open: { owner: 'patient', status: 'pending', title: n => `${n} asked for something from you` },
  appointment_booked: { owner: 'resource', status: 'done', title: n => `Appointment booked with ${n}` },
  connected: { owner: 'resource', status: 'done', title: n => `Connected with ${n}` },
  declined: { owner: 'patient', status: 'blocked', title: n => `${n} declined` },
  stalled: { owner: 'patient', status: 'blocked', title: n => `No response from ${n}` },
};

function contactItem(c: BoardContact, name: string, href: string): BoardItem {
  const s = CONTACT_STATE[c.state] ?? CONTACT_STATE.drafted;
  return {
    id: `contact:${c.id}`, owner: { kind: s.owner, name: s.owner === 'patient' ? 'You' : name }, title: clip(s.title(name), 200),
    detail: c.nextFollowUpAt && s.status === 'waiting' ? 'A follow-up is scheduled' : null, status: s.status,
    due: s.status === 'waiting' ? c.nextFollowUpAt : null, resourceKey: c.resourceKey, origin: 'contact', href, sourceUrl: null,
  };
}

function taskItem(t: BoardTask, name: string, href: string): BoardItem {
  const label = clip(t.title?.trim() || `${t.kind} task`, 200);
  const state = t.status === 'open' ? { owner: { kind: 'patient' as const, name: 'You' }, status: 'pending' as const }
    : t.status === 'approved' ? { owner: { kind: 'resource' as const, name }, status: 'waiting' as const }
      : { owner: { kind: 'patient' as const, name: 'You' }, status: 'done' as const };
  return { id: `task:${t.id}`, ...state, title: label, detail: null, due: t.status === 'done' ? null : t.dueAt, resourceKey: t.resourceKey, origin: 'task', href, sourceUrl: null };
}

const dueMs = (d: string | null) => (d ? Date.parse(d) : Number.POSITIVE_INFINITY);
function compare(a: BoardItem, b: BoardItem): number {
  return RANK[a.status] - RANK[b.status] || (dueMs(a.due) === dueMs(b.due) ? 0 : dueMs(a.due) < dueMs(b.due) ? -1 : 1) || a.id.localeCompare(b.id);
}
