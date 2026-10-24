import { describe, expect, it } from 'vitest';
import { approveTask } from '../../lib/inbox/approve';
import type { Contact, Draft } from '../../lib/outreach/types';
import { activeContactCount } from '../../lib/safety/caps';
import { id, setup } from './helpers';

describe('approveTask', () => {
  it.each([['send_slides', 'lab@example.com'], ['send_records', 'dr@example.com']] as const)('%s creates an unsent draft for the recipient', async (cls, to) => {
    const t = setup(); const task = await t.make({ class: cls });
    const res = await approveTask(task.id, t.deps) as { draft: Draft; contact: Contact; next: string[] };
    expect(res.contact.address).toBe(to);
    expect(res.draft.approvedAt).toBeNull(); expect(res.draft.sentAt).toBeNull();
    expect(res.draft.contactId).toBe(res.contact.id);
    expect(res.next).toEqual(['consent', 'approve']);
    expect(t.channel.sent).toHaveLength(0); expect(t.outreach.deliveries).toHaveLength(0);
    expect((await t.tasks.task(task.id))!.status).toBe('done');
  });
  it('reuses an existing contact for the same address', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    await approveTask(task.id, t.deps);
    const again = await t.make({ class: 'send_records' });
    await approveTask(again.id, t.deps);
    expect(t.outreach.people.filter(c => c.address === 'dr@example.com')).toHaveLength(1);
  });
  it('declined closes the contact and offers the next candidate', async () => {
    const t = setup(); t.tasks.next = { id: id(), targetKind: 'expert', targetId: id() };
    const task = await t.make({ class: 'declined' });
    const res = await approveTask(task.id, t.deps) as { nextCandidate: unknown };
    expect(t.tasks.closed).toEqual([t.original.id]); expect(res.nextCandidate).toEqual(t.tasks.next);
  });
  it('call returns phone, hours, and what to have ready', async () => {
    const t = setup(); const task = await t.make({ class: 'call_to_schedule', phone: '+14155550123', hours: '9-5', haveReady: ['insurance card'] });
    const res = await approveTask(task.id, t.deps) as { call: unknown };
    expect(res.call).toEqual({ phone: '+14155550123', hours: '9-5', haveReady: ['insurance card'] });
    expect(t.channel.sent).toHaveLength(0);
  });
  it('unclear is marked done', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    await approveTask(task.id, t.deps); expect((await t.tasks.task(task.id))!.status).toBe('done');
  });
  it('redirect creates a counted contact; cap blocks it and leaves the task open', async () => {
    const t = setup(); const task = await t.make({ class: 'redirect', redirect: { name: 'Intake', email: 'new@example.com' } });
    const res = await approveTask(task.id, t.deps, { confirmAddress: 'new@example.com' }) as { contact: Contact };
    expect(res.contact.address).toBe('new@example.com'); expect(res.contact.targetId).toBe(t.original.targetId);
    expect(activeContactCount(t.outreach.people)).toBe(2);
    const full = setup(); full.outreach.people.push(...Array.from({ length: 4 }, () => ({ ...full.original, id: id(), address: `x${id()}@example.com` })));
    const blocked = await full.make({ class: 'redirect', redirect: { email: 'new@example.com' } });
    await expect(approveTask(blocked.id, full.deps, { confirmAddress: 'new@example.com' })).rejects.toMatchObject({ status: 422, reasons: ['contact_cap'] });
    expect((await full.tasks.task(blocked.id))!.status).toBe('open');
    expect(full.outreach.drafts.size).toBe(0);
  });
  it('a redirect with only a name is a look-up call task, not an email to a guessed address', async () => {
    const t = setup(); const task = await t.make({ class: 'redirect', redirect: { name: 'Someone' } });
    expect(task.kind).toBe('call'); expect(task.letter).toBeUndefined();
    const res = await approveTask(task.id, t.deps) as { call: { phone?: string } };
    expect(res.call.phone).toBeUndefined();
    expect(t.outreach.drafts.size).toBe(0); expect(t.channel.sent).toHaveLength(0);
  });
  it('records without any known recipient become a prepared letter, never an outbound', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' }, { currentPhysician: undefined });
    expect(task.letter?.to).toBeUndefined();
    const res = await approveTask(task.id, t.deps) as { prepared: { subject: string; body: string; instructions: string } };
    expect(res.prepared.body).toBe(task.letter!.body);
    expect(res.prepared.instructions).toMatch(/will not guess/);
    expect(t.outreach.drafts.size).toBe(0); expect(t.channel.sent).toHaveLength(0);
    expect((await t.tasks.task(task.id))!.status).toBe('done');
  });
  it('a referral is a prepare-to-forward letter: no recipient, no draft, no send', async () => {
    const t = setup(); const task = await t.make({ class: 'needs_referral' });
    const res = await approveTask(task.id, t.deps) as { prepared: { body: string; instructions: string } };
    expect(res.prepared.body).toContain('send a referral to Example Cancer Center');
    expect(res.prepared.instructions).toMatch(/give it to your doctor yourself/);
    expect(t.outreach.drafts.size).toBe(0); expect(t.outreach.people).toHaveLength(1); expect(t.channel.sent).toHaveLength(0);
    await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 409 });
  });
  describe('slides and records go back to the address that asked', () => {
    const asked = { replyTo: { name: 'Pat Coordinator', email: 'coord@clinic.test' } };
    it('a different sender is a verified reply on this thread and becomes the draft recipient', async () => {
      const t = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'coord@clinic.test' });
      const task = await t.make({ class: 'send_records' }, asked);
      expect(task.letter?.to).toBe('coord@clinic.test');
      expect(task.letter?.body).toContain('You asked for copies of the patient');
      const res = await approveTask(task.id, t.deps) as { contact: Contact; draft: Draft };
      expect(res.contact.address).toBe('coord@clinic.test');
      expect(res.draft.approvedAt).toBeNull();
      expect(t.channel.sent).toHaveLength(0);
    });
    it('replying from the contact\'s own address reuses that contact', async () => {
      const t = setup(); const task = await t.make({ class: 'send_slides' }, { replyTo: { name: '', email: 'Intake@Example.com' } });
      const res = await approveTask(task.id, t.deps) as { contact: Contact };
      expect(res.contact.id).toBe(t.original.id);
    });
    it('is refused when the task has no verifiable stored reply', async () => {
      const t = setup(); const task = await t.make({ class: 'send_records' }, { ...asked, messageId: undefined });
      await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 422, reasons: ['reply_unverified'] });
      expect((await t.tasks.task(task.id))!.status).toBe('open');
    });
    it('is refused when the stored letter recipient differs from the address that asked', async () => {
      const t = setup(); const task = await t.make({ class: 'send_records' }, asked);
      t.tasks.rows.get(task.id)!.letter!.to = 'other@clinic.test';
      await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 422, reasons: ['recipient_missing'] });
    });
  });
  it('404 for unknown and 409 on a second approval', async () => {
    const t = setup();
    await expect(approveTask(id(), t.deps)).rejects.toMatchObject({ status: 404 });
    const task = await t.make({ class: 'send_records' });
    await approveTask(task.id, t.deps);
    await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 409 });
    expect(t.outreach.drafts.size).toBe(1);
  });
  it('the created draft only sends through OutreachService.approve after per-contact consent and checkOutbound', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    const res = await approveTask(task.id, t.deps) as { draft: Draft; contact: Contact };
    await expect(t.service.approve(res.contact.id, res.draft.id)).rejects.toMatchObject({ status: 422, reasons: ['consent_required'] });
    await t.service.consent(res.contact.id, ['diseaseName']);
    await t.service.approve(res.contact.id, res.draft.id);
    expect(t.channel.sent).toHaveLength(1); expect(t.channel.sent[0].address).toBe('dr@example.com');
  });
  it('a non-allowlisted recipient is refused by the gate', async () => {
    const t = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'someone@example.com' }); const task = await t.make({ class: 'send_records' });
    const res = await approveTask(task.id, t.deps) as { draft: Draft; contact: Contact };
    await t.service.consent(res.contact.id, ['diseaseName']);
    await expect(t.service.approve(res.contact.id, res.draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(t.channel.sent).toHaveLength(0);
  });
});
