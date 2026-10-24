import { describe, expect, it } from 'vitest';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import { boardSchema, type ConsultRequest, type ConsultStatus, type RequirementsChecklist } from '@/lib/coordination/contract';
import { buildBoard, type BoardDeps } from '@/lib/coordination/board';

const CASE = '11111111-1111-4111-8111-111111111111';
const DOCTOR = '33333333-3333-4333-8333-333333333333';
const KEY = 'institution:aaaa1111';
const NOW = '2026-10-24T00:00:00.000Z';
const day = (n: number) => new Date(Date.parse(NOW) + n * 86_400_000).toISOString();

const checklist: RequirementsChecklist = {
  caseId: CASE, resourceKey: KEY, name: 'Synthetic Center', checkedUrls: [], unavailableReason: null, version: 1, createdAt: NOW, updatedAt: NOW,
  requirements: (['missing', 'patient_to_request', 'have', 'unknown'] as const).map((status, i) => ({
    id: `r${i}`, kind: 'records' as const, label: `Requirement ${status}`, detail: '', sourceUrl: `https://example.org/r${i}`, origin: 'fixture' as const,
    status, matchedDocId: null, note: null, updatedAt: NOW,
  })),
};
const consult = (status: ConsultStatus, id = '44444444-4444-4444-8444-444444444444'): ConsultRequest => ({
  id, caseId: CASE, resourceKey: KEY, expertName: 'Dr. Expert', doctorId: DOCTOR,
  process: { kind: 'econsult', detail: '', sourceUrl: 'https://example.org/e', expertAddress: null, addressEvidenceId: null },
  subject: 'Request', body: 'Body', packetId: null, sharedFields: [], status, reviewTokenHash: null, reviewTokenExpiresAt: status === 'sent_to_doctor' ? day(5) : null,
  sentToDoctorAt: null, doctorEdited: false, doctorApprovedAt: null, doctorDeclinedAt: null, doctorNote: null, approvedBodyHash: null, patientConsentAt: null,
  sentAt: null, providerMessageId: null, failureReasons: [], version: 1, createdAt: NOW, updatedAt: NOW,
});

async function deps(over: Partial<BoardDeps> = {}, consults: ConsultRequest[] = [], withChecklist = true): Promise<BoardDeps> {
  const store = new MemoryCoordinationStore();
  if (withChecklist) await store.save(CASE, 'checklist', KEY, checklist);
  await store.save(CASE, 'doctor', DOCTOR, { id: DOCTOR, caseId: CASE, name: 'Dr. Local', practice: null, email: 'local@example.org', createdAt: NOW });
  for (const c of consults) await store.save(CASE, 'consult', c.id, c);
  return { store, now: () => new Date(NOW), names: async () => ({ [KEY]: 'Synthetic Center' }), contacts: async () => [], tasks: async () => [], ...over };
}

describe('buildBoard', () => {
  it('returns a schema-valid board with requirement items for missing / patient_to_request / have only', async () => {
    const board = await buildBoard(CASE, await deps());
    expect(boardSchema.safeParse(board).success).toBe(true);
    const req = board.items.filter(i => i.origin === 'requirement');
    expect(req.map(i => [i.title.replace('Requirement ', ''), i.status, i.owner.kind])).toEqual(expect.arrayContaining([['missing', 'pending', 'patient'], ['patient_to_request', 'pending', 'patient'], ['have', 'done', 'patient']]));
    expect(req).toHaveLength(3);
    for (const i of req) expect(i.sourceUrl).toMatch(/^https:\/\/example\.org\/r\d$/);
  });

  it.each([
    ['drafted', 'patient', 'pending'], ['doctor_approved', 'patient', 'pending'], ['ready', 'patient', 'pending'],
    ['sent_to_doctor', 'doctor', 'waiting'], ['sent', 'resource', 'waiting'],
    ['doctor_declined', 'patient', 'blocked'], ['failed', 'patient', 'blocked'],
  ] as const)('consult %s -> owner %s, %s', async (st, owner, status) => {
    const board = await buildBoard(CASE, await deps({}, [consult(st)], false));
    const item = board.items.find(i => i.origin === 'consult')!;
    expect(item.owner.kind).toBe(owner);
    expect(item.status).toBe(status);
    if (owner === 'doctor') expect(item.owner.name).toBe('Dr. Local');
    if (owner === 'resource') expect(item.owner.name).toBe('Dr. Expert');
  });

  it('skips cancelled consults; sent_to_doctor due is the link expiry', async () => {
    expect((await buildBoard(CASE, await deps({}, [consult('cancelled')], false))).items).toHaveLength(0);
    const waiting = (await buildBoard(CASE, await deps({}, [consult('sent_to_doctor')], false))).items[0];
    expect(waiting.due).toBe(day(5));
  });

  it('contacts: state decides owner; nextFollowUpAt is due', async () => {
    const mk = (id: string, state: string, due: string | null) => ({ id, resourceKey: KEY, state, nextFollowUpAt: due });
    const board = await buildBoard(CASE, await deps({ contacts: async () => [mk('c1', 'drafted', null), mk('c2', 'sent', day(3)), mk('c3', 'replied', null), mk('c4', 'connected', null), mk('c5', 'stalled', null)] }, [], false));
    const by = Object.fromEntries(board.items.filter(i => i.origin === 'contact').map(i => [i.id.split(':')[1], i]));
    expect([by.c1.owner.kind, by.c1.status]).toEqual(['patient', 'pending']);
    expect([by.c2.owner.kind, by.c2.status, by.c2.due]).toEqual(['resource', 'waiting', day(3)]);
    expect([by.c3.owner.kind, by.c3.status]).toEqual(['patient', 'pending']);
    expect(by.c4.status).toBe('done');
    expect(by.c5.status).toBe('blocked');
  });

  it('tasks: open is patient pending with due; approved waits on the resource; done is done', async () => {
    const t = (id: string, status: 'open' | 'approved' | 'done', dueAt: string | null) => ({ id, title: `Task ${id}`, kind: 'records', status, dueAt, resourceKey: KEY });
    const board = await buildBoard(CASE, await deps({ tasks: async () => [t('t1', 'open', day(2)), t('t2', 'approved', null), t('t3', 'done', null)] }, [], false));
    const by = Object.fromEntries(board.items.filter(i => i.origin === 'task').map(i => [i.id.split(':')[1], i]));
    expect([by.t1.owner.kind, by.t1.status, by.t1.due]).toEqual(['patient', 'pending', day(2)]);
    expect([by.t2.owner.kind, by.t2.status]).toEqual(['resource', 'waiting']);
    expect(by.t3.status).toBe('done');
  });

  it('sorts blocked, then pending by soonest due (undated last), then waiting, then done', async () => {
    const d = await deps({
      contacts: async () => [{ id: 'c1', resourceKey: KEY, state: 'sent', nextFollowUpAt: day(1) }, { id: 'c2', resourceKey: KEY, state: 'stalled', nextFollowUpAt: null }],
      tasks: async () => [
        { id: 'late', title: 'Late', kind: 'records', status: 'open', dueAt: day(9), resourceKey: KEY },
        { id: 'soon', title: 'Soon', kind: 'records', status: 'open', dueAt: day(1), resourceKey: KEY },
        { id: 'fin', title: 'Fin', kind: 'records', status: 'done', dueAt: null, resourceKey: KEY },
      ],
    }, [], true);
    const order = (await buildBoard(CASE, d)).items.map(i => i.status);
    const rank = { blocked: 0, pending: 1, waiting: 2, done: 3 } as const;
    expect(order.map(s => rank[s])).toEqual([...order.map(s => rank[s])].sort((a, b) => a - b));
    const pending = (await buildBoard(CASE, d)).items.filter(i => i.status === 'pending');
    const dues = pending.map(i => i.due);
    const firstUndated = dues.indexOf(null);
    expect(firstUndated === -1 || dues.slice(firstUndated).every(x => x === null)).toBe(true);
    const dated = dues.filter((x): x is string => x !== null);
    expect(dated).toEqual([...dated].sort());
  });
});
