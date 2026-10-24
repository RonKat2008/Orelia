import { describe, expect, it } from 'vitest';
import { addressInText, approveTask } from '../../lib/inbox/approve';
import { inboundReplyContactPoint } from '../../lib/inbox/contact-point';
import { inboxHandlers } from '../../lib/inbox/http';
import type { Contact, Draft } from '../../lib/outreach/types';
import { id, setup } from './helpers';

const redirect = (t: ReturnType<typeof setup>, email: string, over: Record<string, unknown> = {}) =>
  t.make({ class: 'redirect', redirect: { name: 'Intake', email }, quote: 'contact intake' }, over);
const expectRefused = async (t: ReturnType<typeof setup>, taskId: string, reasons: string[], confirm?: string) => {
  await expect(approveTask(taskId, t.deps, { confirmAddress: confirm })).rejects.toMatchObject({ status: 422, reasons });
  expect((await t.tasks.task(taskId))!.status).toBe('open');
  expect(t.outreach.people).toHaveLength(1);
  expect(t.outreach.drafts.size).toBe(0);
};

describe('addressInText', () => {
  it('matches whole tokens case-insensitively with surrounding punctuation', () => {
    expect(addressInText('intake@example.org', 'write to <Intake@Example.org>.')).toBe(true);
    expect(addressInText('intake@example.org', 'write\n  to   INTAKE@example.org,\nthanks')).toBe(true);
  });
  it('rejects substrings and split addresses', () => {
    expect(addressInText('intake@example.org', 'evilintake@example.org')).toBe(false);
    expect(addressInText('intake@example.org', 'intake@example.org.evil.com')).toBe(false);
    expect(addressInText('intake@example.org', 'intake@\nexample.org')).toBe(false);
    expect(addressInText('intake@example.org', 'nothing here')).toBe(false);
  });
});

describe('redirect grounding', () => {
  it('model-invented address not in the reply is refused', async () => {
    const t = setup(); const task = await redirect(t, 'invented@example.com');
    await expectRefused(t, task.id, ['redirect_address_not_in_reply'], 'invented@example.com');
  });
  it('literal address in different case passes and returns evidence', async () => {
    const t = setup(); const task = await redirect(t, 'new@example.com');
    const res = await approveTask(task.id, t.deps, { confirmAddress: '  NEW@example.com ' }) as { contact: Contact; evidence: unknown };
    expect(res.contact.address).toBe('new@example.com');
    expect(res.evidence).toMatchObject({ claimType: 'contact_point.email.inbound_reply', claim: 'new@example.com', sourceUrl: `urn:wayfinder:message:${t.msg.id}`, sourceKind: 'inbound_reply' });
    expect((await t.tasks.task(task.id))!.details?.evidence).toMatchObject({ claim: 'new@example.com' });
  });
  it('substring trick is refused', async () => {
    const t = setup();
    t.inbound.add({ id: t.msg.id, contactId: t.original.id, body: 'Reach evilintake@example.org please' });
    const task = await redirect(t, 'intake@example.org');
    await expectRefused(t, task.id, ['redirect_address_not_in_reply'], 'intake@example.org');
  });
  it('message from another contact is redirect_unverified', async () => {
    const t = setup(); t.inbound.add({ id: t.msg.id, contactId: id(), body: 'new@example.com' });
    const task = await redirect(t, 'new@example.com');
    await expectRefused(t, task.id, ['redirect_unverified'], 'new@example.com');
  });
  it('missing or unknown messageId is redirect_unverified', async () => {
    const t = setup(); const none = await redirect(t, 'new@example.com', { messageId: undefined });
    await expectRefused(t, none.id, ['redirect_unverified'], 'new@example.com');
    const unknown = await redirect(t, 'new@example.com', { messageId: id() });
    await expectRefused(t, unknown.id, ['redirect_unverified'], 'new@example.com');
  });
  it('confirmation is required and must match', async () => {
    const t = setup(); const task = await redirect(t, 'new@example.com');
    await expectRefused(t, task.id, ['address_confirmation_required']);
    await expectRefused(t, task.id, ['address_confirmation_mismatch'], 'other@example.com');
  });
  it('non-redirect tasks ignore confirmAddress', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    await approveTask(task.id, t.deps, { confirmAddress: 'whatever@example.com' });
    expect((await t.tasks.task(task.id))!.status).toBe('done');
  });
  it('cap is still enforced', async () => {
    const t = setup(); t.outreach.people.push(...Array.from({ length: 4 }, () => ({ ...t.original, id: id(), address: `x${id()}@example.com` })));
    const task = await redirect(t, 'new@example.com');
    await expect(approveTask(task.id, t.deps, { confirmAddress: 'new@example.com' })).rejects.toMatchObject({ reasons: ['contact_cap'] });
    expect((await t.tasks.task(task.id))!.status).toBe('open');
  });
  it('the created draft is gated by the allowlist', async () => {
    const blocked = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'other@example.com' });
    const r1 = await approveTask((await redirect(blocked, 'new@example.com')).id, blocked.deps, { confirmAddress: 'new@example.com' }) as { draft: Draft; contact: Contact };
    await blocked.service.consent(r1.contact.id, ['diseaseName']);
    await expect(blocked.service.approve(r1.contact.id, r1.draft.id)).rejects.toMatchObject({ reasons: expect.arrayContaining(['not_allowlisted']) });
    const ok = setup({ NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'new@example.com' });
    const r2 = await approveTask((await redirect(ok, 'new@example.com')).id, ok.deps, { confirmAddress: 'new@example.com' }) as { draft: Draft; contact: Contact };
    await ok.service.consent(r2.contact.id, ['diseaseName']);
    await ok.service.approve(r2.contact.id, r2.draft.id);
    expect(ok.channel.sent).toHaveLength(1);
  });
});

describe('http', () => {
  it('parses confirmAddress from the body and GET returns confirm', async () => {
    const t = setup(); const task = await redirect(t, 'new@example.com');
    const api = inboxHandlers(t.deps);
    const got = await (await api.get(new Request('http://x'), task.id)).json();
    expect(got.confirm).toEqual({ address: 'new@example.com', quote: 'contact intake' });
    const bad = await api.approve(new Request('http://x', { method: 'POST', body: JSON.stringify({ confirmAddress: 'zzz@example.com' }) }), task.id);
    expect(bad.status).toBe(422); expect((await bad.json()).reasons).toEqual(['address_confirmation_mismatch']);
    const ok = await api.approve(new Request('http://x', { method: 'POST', body: JSON.stringify({ confirmAddress: 'new@example.com' }) }), task.id);
    expect(ok.status).toBe(200);
    expect((await api.approve(new Request('http://x', { method: 'POST', body: '{"confirmAddress":5}' }), id())).status).toBe(400);
  });
  it('evidence builder shape', () => {
    expect(inboundReplyContactPoint({ channel: 'email', address: 'a@b.co', messageId: 'm', receivedAt: 'T' })).toEqual({
      id: 'contact_point:inbound_reply:a@b.co:m', claimType: 'contact_point.email.inbound_reply', claim: 'a@b.co', sourceUrl: 'urn:wayfinder:message:m', sourceKind: 'inbound_reply', fetchedAt: 'T',
    });
  });
});
