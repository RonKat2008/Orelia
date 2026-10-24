import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approveAndSendRequest, createRequestDraft, draftRequest, RequestError, type RequestDeps, type RequestMessage } from '@/lib/appointments/request';
import { LETTER_INTRO } from '@/lib/inbox/drafts';
import type { Contact } from '@/lib/outreach/types';
import { AI_DISCLOSURE_EMAIL, flagMedicalAdvice } from '@/lib/safety';
import { CASE_ID, makeAppointment } from './fixtures';

const CONTACT_ID = '66666666-6666-4666-8666-666666666666';
const OFFICE = 'office@clinic.test';
const NOW = new Date('2026-10-24T15:00:00Z');

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: CONTACT_ID, caseId: CASE_ID, targetId: 'target-1', targetKind: 'institution', channel: 'email', address: OFFICE, state: 'replied',
  lastSentAt: null, followUpsSent: 0, ...over,
});

interface Harness { deps: RequestDeps; messages: Map<string, RequestMessage>; send: ReturnType<typeof vi.fn>; withdraw: ReturnType<typeof vi.fn>; approve: ReturnType<typeof vi.fn>; delivered: ReturnType<typeof vi.fn> }

function harness(opts: { contact?: Contact; allowlist?: string[]; consent?: boolean; firstSentAt?: string } = {}): Harness {
  const messages = new Map<string, RequestMessage>();
  const c = opts.contact ?? contact();
  const send = vi.fn(async () => ({ messageId: 'prov-2', threadId: 'thr-1' }));
  const approve = vi.fn(async (id: string, _c: string, at: string) => {
    const m = messages.get(id);
    if (!m || m.approvedAt || m.sentAt) return false;
    messages.set(id, { ...m, approvedAt: at });
    return true;
  });
  const withdraw = vi.fn(async (id: string) => { const m = messages.get(id); if (m) messages.set(id, { ...m, approvedAt: null }); });
  const delivered = vi.fn(async (id: string, _r: unknown, at: string) => { const m = messages.get(id); if (m) messages.set(id, { ...m, sentAt: at }); });
  const deps: RequestDeps = {
    saveDraft: async i => { const id = crypto.randomUUID(); messages.set(id, { id, contactId: i.contactId, subject: i.subject, body: i.body, approvedAt: null, sentAt: null }); return id; },
    message: async id => messages.get(id),
    approve, withdraw, delivered,
    thread: async () => ({ messageId: 'prov-1', threadId: 'thr-1' }),
    contact: async id => (id === c.id ? c : undefined),
    contacts: async () => [{ ...c, firstSentAt: opts.firstSentAt ?? '2026-10-01T15:00:00Z' }],
    consent: async () => (opts.consent === false ? undefined : { contactId: c.id, sharedFields: [], approvedAt: '2026-10-01T15:00:00Z' }),
    getCase: async () => ({ diagnosis: 'osteosarcoma', patientName: 'Jane Doe' }),
    send,
    env: { NODE_ENV: 'test' },
    allowlist: opts.allowlist ?? [OFFICE],
    clock: () => NOW,
  };
  return { deps, messages, send, withdraw, approve, delivered };
}

const appt = (over = {}) => makeAppointment({ contactId: CONTACT_ID, ...over });

describe('draftRequest', () => {
  it('discloses the AI author and uses the standard letter intro', () => {
    const d = draftRequest(appt(), 'cancel');
    expect(d.body).toContain(AI_DISCLOSURE_EMAIL);
    expect(d.body).toContain(LETTER_INTRO);
    expect(d.subject).toMatch(/^Cancellation/);
  });

  it('contains no medical advice', () => {
    for (const kind of ['reschedule', 'cancel'] as const) {
      const d = draftRequest(appt(), kind, { note: 'Running late with paperwork', freeTimes: ['Mon Nov 16, 10:00 AM'] });
      expect(flagMedicalAdvice(`${d.subject}\n${d.body}`).flagged).toBe(false);
    }
  });

  it('lists free times for a reschedule, but not for a cancel', () => {
    const times = ['Mon Nov 16, 10:00 AM', 'Tue Nov 17, 9:00 AM'];
    const r = draftRequest(appt(), 'reschedule', { freeTimes: times });
    for (const t of times) expect(r.body).toContain(`- ${t}`);
    expect(draftRequest(appt(), 'cancel', { freeTimes: times }).body).not.toContain(times[0]);
  });
});

describe('createRequestDraft', () => {
  it('saves a draft for an email contact with consent', async () => {
    const h = harness();
    const out = await createRequestDraft(appt(), 'reschedule', h.deps);
    expect(h.messages.get(out.messageId)?.body).toContain(AI_DISCLOSURE_EMAIL);
  });

  it('refuses a voice contact with call_the_office', async () => {
    const h = harness({ contact: contact({ channel: 'voice', address: '+12165550100' }) });
    await expect(createRequestDraft(appt(), 'cancel', h.deps)).rejects.toMatchObject({ status: 422, reasons: ['call_the_office'] });
  });

  it('refuses when consent is missing', async () => {
    const h = harness({ consent: false });
    await expect(createRequestDraft(appt(), 'cancel', h.deps)).rejects.toMatchObject({ status: 422, reasons: ['consent_required'] });
  });

  it('refuses an appointment with no contact', async () => {
    const h = harness();
    await expect(createRequestDraft(appt({ contactId: null }), 'cancel', h.deps)).rejects.toMatchObject({ reasons: ['no_contact'] });
  });
});

describe('approveAndSendRequest', () => {
  let h: Harness;
  let a: ReturnType<typeof appt>;

  async function prepare(opts: Parameters<typeof harness>[0] = {}) {
    h = harness(opts);
    const { messageId } = await createRequestDraft(appt(), 'cancel', h.deps);
    a = appt({ requestMessageId: messageId });
    return messageId;
  }

  beforeEach(() => vi.unstubAllEnvs());

  it('refuses a non-allowlisted address without approving or sending', async () => {
    await prepare({ allowlist: ['someone-else@example.test'] });
    const err = await approveAndSendRequest(a, h.deps).catch(e => e);
    expect(err).toBeInstanceOf(RequestError);
    expect(err.reasons).toContain('not_allowlisted');
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('refuses while the follow-up cadence is not satisfied', async () => {
    await prepare({ firstSentAt: '2026-10-24T14:00:00Z' });
    const err = await approveAndSendRequest(a, h.deps).catch(e => e);
    expect(err.reasons).toContain('follow_up_cadence');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('approves once and sends exactly once in the office thread, then marks delivered', async () => {
    const id = await prepare();
    const out = await approveAndSendRequest(a, h.deps);
    expect(h.approve).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][1]).toEqual({ messageId: 'prov-1', threadId: 'thr-1' });
    expect(h.send.mock.calls[0][0]).toMatchObject({ address: OFFICE, channel: 'email' });
    expect(h.delivered).toHaveBeenCalledWith(id, { messageId: 'prov-2', threadId: 'thr-1' }, NOW.toISOString());
    expect(out.sentAt).toBe(NOW.toISOString());
    expect(h.messages.get(id)?.sentAt).toBe(NOW.toISOString());
  });

  it('answers 409 on a second approval and does not send again', async () => {
    await prepare();
    await approveAndSendRequest(a, h.deps);
    await expect(approveAndSendRequest(a, h.deps)).rejects.toMatchObject({ status: 409 });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('withdraws the approval when the send throws', async () => {
    const id = await prepare();
    h.send.mockRejectedValue(new Error('provider down'));
    await expect(approveAndSendRequest(a, h.deps)).rejects.toThrow('provider down');
    expect(h.withdraw).toHaveBeenCalledWith(id, CONTACT_ID);
    expect(h.delivered).not.toHaveBeenCalled();
    expect(h.messages.get(id)?.approvedAt).toBeNull();
  });

  it('answers 404 when the appointment has no request message', async () => {
    await prepare();
    await expect(approveAndSendRequest(appt({ requestMessageId: null }), h.deps)).rejects.toMatchObject({ status: 404 });
  });
});
