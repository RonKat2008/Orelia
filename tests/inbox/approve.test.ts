import { describe, expect, it } from 'vitest';
import { approveTask } from '../../lib/inbox/approve';
import type { Contact, Draft } from '../../lib/outreach/types';
import { activeContactCount } from '../../lib/safety/caps';
import { id, setup } from './helpers';

describe('approveTask', () => {
  it.each([['needs_referral', 'dr@example.com'], ['send_slides', 'lab@example.com'], ['send_records', 'dr@example.com']] as const)('%s creates an unsent draft for the recipient', async (cls, to) => {
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
    const t = setup(); const task = await t.make({ class: 'needs_referral' });
    await approveTask(task.id, t.deps);
    const again = await t.make({ class: 'needs_referral' });
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
  it('redirect without a reply email is 422 recipient_missing', async () => {
    const t = setup(); const task = await t.make({ class: 'redirect', redirect: { name: 'Someone' } });
    await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 422, reasons: ['recipient_missing'] });
    expect((await t.tasks.task(task.id))!.status).toBe('open');
  });
  it('referral without a physician address is 422', async () => {
    const t = setup(); const task = await t.make({ class: 'needs_referral' }, { currentPhysician: undefined });
    await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 422, reasons: ['recipient_missing'] });
  });
  it('404 for unknown and 409 on a second approval', async () => {
    const t = setup();
    await expect(approveTask(id(), t.deps)).rejects.toMatchObject({ status: 404 });
    const task = await t.make({ class: 'needs_referral' });
    await approveTask(task.id, t.deps);
    await expect(approveTask(task.id, t.deps)).rejects.toMatchObject({ status: 409 });
    expect(t.outreach.drafts.size).toBe(1);
  });
  it('the created draft only sends through OutreachService.approve after per-contact consent and checkOutbound', async () => {
    const t = setup(); const task = await t.make({ class: 'needs_referral' });
    const res = await approveTask(task.id, t.deps) as { draft: Draft; contact: Contact };
    await expect(t.service.approve(res.contact.id, res.draft.id)).rejects.toMatchObject({ status: 422, reasons: ['consent_required'] });
    await t.service.consent(res.contact.id, ['diseaseName']);
    await t.service.approve(res.contact.id, res.draft.id);
    expect(t.channel.sent).toHaveLength(1); expect(t.channel.sent[0].address).toBe('dr@example.com');
  });
  it('a non-allowlisted recipient is refused by the gate', async () => {
    const t = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'someone@example.com' }); const task = await t.make({ class: 'needs_referral' });
    const res = await approveTask(task.id, t.deps) as { draft: Draft; contact: Contact };
    await t.service.consent(res.contact.id, ['diseaseName']);
    await expect(t.service.approve(res.contact.id, res.draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(t.channel.sent).toHaveLength(0);
  });
});
