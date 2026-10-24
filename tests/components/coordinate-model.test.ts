import { describe, expect, it } from 'vitest';
import { availableActions, consultTimeline, formatDue, groupBoard, includedSections, refusalMessages, checklistProgress, isSafeHttpUrl } from '@/components/coordinate/model';

const item = (id: string, kind: 'patient' | 'doctor' | 'resource', status: 'done' | 'pending' | 'waiting' | 'blocked', due: string | null) =>
  ({ id, owner: { kind, name: kind }, title: id, detail: null, status, due, resourceKey: null, origin: 'task' as const, href: null, sourceUrl: null });

describe('coordinate model', () => {
  it('groups board by owner, open items and earlier due dates first', () => {
    const groups = groupBoard({ items: [item('a', 'patient', 'done', null), item('b', 'patient', 'pending', '2026-11-05T00:00:00.000Z'), item('c', 'patient', 'pending', '2026-11-01T00:00:00.000Z'), item('d', 'resource', 'waiting', null)] });
    expect(groups.map(g => g.key)).toEqual(['patient', 'resource']);
    expect(groups[0].items.map(i => i.id)).toEqual(['c', 'b', 'a']);
    expect(groupBoard(null)).toEqual([]);
  });
  it('timeline marks current step and stops at a decline', () => {
    const base = { status: 'sent_to_doctor' as const, doctorApprovedAt: null, doctorDeclinedAt: null, patientConsentAt: null, sentAt: null, sentToDoctorAt: '2026-10-01T00:00:00.000Z' };
    expect(consultTimeline(base).map(s => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    const declined = consultTimeline({ ...base, status: 'doctor_declined', doctorDeclinedAt: '2026-10-02T00:00:00.000Z' });
    expect(declined[2]).toMatchObject({ state: 'stopped', label: 'Doctor declined' });
    expect(declined[3].state).toBe('upcoming');
  });
  it('offers only valid actions per status', () => {
    expect(availableActions('drafted')).toContain('send_to_doctor');
    expect(availableActions('doctor_approved')).toEqual(['consent', 'cancel']);
    expect(availableActions('sent')).toEqual([]);
  });
  it('turns refusal codes into plain language without leaking codes', () => {
    const out = refusalMessages(['no_patient_consent', 'weird_internal_code']);
    expect(out.join(' ')).not.toMatch(/_/);
    expect(out).toHaveLength(2);
    expect(refusalMessages(undefined)).toEqual([]);
  });
  it('filters included sections, counts progress, checks urls and formats due dates', () => {
    const s = (included: boolean) => ({ key: 'summary' as const, title: 't', items: [], included });
    expect(includedSections([s(true), s(false)])).toHaveLength(1);
    expect(checklistProgress(['have', 'missing', 'have'])).toEqual({ have: 2, total: 3 });
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('https://example.org/x')).toBe(true);
    const now = new Date('2026-10-24T00:00:00Z');
    expect(formatDue('2026-10-20T00:00:00Z', now)).toBe('Was due Oct 20');
    expect(formatDue('2026-11-02T00:00:00Z', now)).toBe('Due Nov 2');
    expect(formatDue(null, now)).toBeNull();
  });
});
