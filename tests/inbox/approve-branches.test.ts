import { describe, expect, it, vi } from 'vitest';
import { addressInText, approveTask } from '../../lib/inbox/approve';
import { inboundReplyContactPoint } from '../../lib/inbox/contact-point';
import { inboxHandlers } from '../../lib/inbox/http';
import { id, setup } from './helpers';

const rejects = (p: Promise<unknown>, status: number, reasons: string[]) => expect(p).rejects.toMatchObject({ status, reasons });

describe('approveTask refusals', () => {
  it('404s for an unknown task id', async () => {
    const t = setup();
    await rejects(approveTask(id(), t.deps), 404, ['task_not_found']);
  });
  it('409s when the task is no longer open', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    await approveTask(task.id, t.deps);
    await rejects(approveTask(task.id, t.deps), 409, ['already_approved']);
  });
  it('422s application tasks and points at the application approval path', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    t.tasks.rows.get(task.id)!.kind = 'application';
    await rejects(approveTask(task.id, t.deps), 422, ['use_application_approval']);
    expect(t.tasks.rows.get(task.id)!.status).toBe('open');
  });
  it('409s when another approver wins the compare-and-set on a plain task', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    t.tasks.markApproved = async () => false;
    await rejects(approveTask(task.id, t.deps), 409, ['already_approved']);
  });
  it('uses the real clock when no clock dep is injected', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    const res = await approveTask(task.id, { ...t.deps, clock: undefined }) as { task: { approvedAt: string } };
    expect(Number.isNaN(Date.parse(res.task.approvedAt))).toBe(false);
  });
  it('declined with no next candidate returns nextCandidate null', async () => {
    const t = setup(); const task = await t.make({ class: 'declined' });
    const res = await approveTask(task.id, t.deps) as { nextCandidate: unknown };
    expect(res.nextCandidate).toBeNull();
  });
  it('call task with no details returns an empty haveReady list', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    t.tasks.rows.get(task.id)!.kind = 'call'; t.tasks.rows.get(task.id)!.details = undefined;
    const res = await approveTask(task.id, t.deps) as { call: unknown };
    expect(res.call).toEqual({ phone: undefined, hours: undefined, haveReady: [] });
  });
});

describe('approveTask letters', () => {
  it('422s when the task has no letter at all', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.tasks.rows.get(task.id)!.letter = undefined;
    await rejects(approveTask(task.id, t.deps), 422, ['recipient_missing']);
  });
  it('422s when the letter recipient is not an email address', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.tasks.rows.get(task.id)!.letter!.to = 'not-an-address';
    await rejects(approveTask(task.id, t.deps), 422, ['recipient_missing']);
  });
  it('404s and leaves the task open when the originating contact is gone', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.outreach.people.length = 0;
    await rejects(approveTask(task.id, t.deps), 404, ['contact_not_found']);
    expect(t.tasks.rows.get(task.id)!.status).toBe('open');
  });
  it('409s when the letter task is claimed concurrently', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.tasks.markApproved = async () => false;
    await rejects(approveTask(task.id, t.deps), 409, ['already_approved']);
    expect(t.outreach.drafts.size).toBe(0);
  });
  it('reopens the task and rethrows when saving the draft fails', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.outreach.saveDraft = async () => { throw new Error('db down'); };
    await expect(approveTask(task.id, t.deps)).rejects.toThrow('db down');
    expect(t.tasks.rows.get(task.id)).toMatchObject({ status: 'open', approvedAt: null });
  });
  it('409s recipient_not_created and reopens when select returns no matching contact', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.outreach.select = async () => [];
    await rejects(approveTask(task.id, t.deps), 409, ['recipient_not_created']);
    expect(t.tasks.rows.get(task.id)!.status).toBe('open');
  });
  it('copies no shared fields when the original contact has no consent, and reports consent still needed', async () => {
    const t = setup(); const task = await t.make({ class: 'send_records' });
    t.outreach.consents.clear();
    const res = await approveTask(task.id, t.deps, {}) as { draft: { sharedFields: string[] }; next: string[] };
    expect(res.draft.sharedFields).toEqual([]);
    expect(res.next).toEqual(['consent', 'approve']);
  });
  it('skips the consent step when the recipient already has consent', async () => {
    const t = setup(); const first = await t.make({ class: 'send_records' });
    const a = await approveTask(first.id, t.deps) as { contact: { id: string } };
    t.outreach.consents.set(a.contact.id, { contactId: a.contact.id, sharedFields: [], approvedAt: '2026-10-23T00:00:00Z' });
    const second = await t.make({ class: 'send_records' });
    const res = await approveTask(second.id, t.deps) as { next: string[] };
    expect(res.next).toEqual(['approve']);
  });
});

describe('approveTask redirect grounding', () => {
  const email = 'new@example.com';
  const redirect = async () => { const t = setup(); const task = await t.make({ class: 'redirect', redirect: { email } }); return { t, task, row: t.tasks.rows.get(task.id)! }; };

  it('422 recipient_missing when the redirect email differs from the letter recipient', async () => {
    const { t, task, row } = await redirect();
    row.letter!.to = 'other@example.com';
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['recipient_missing']);
  });
  it('422 redirect_unverified when the task has no source message id', async () => {
    const { t, task, row } = await redirect();
    delete row.details!.messageId;
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['redirect_unverified']);
  });
  it('422 redirect_unverified when the stored message does not exist', async () => {
    const { t, task, row } = await redirect();
    row.details!.messageId = id();
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['redirect_unverified']);
  });
  it('422 redirect_unverified when the message belongs to a different contact thread', async () => {
    const { t, task } = await redirect();
    t.inbound.rows.get(t.msg.id)!.contactId = id();
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['redirect_unverified']);
  });
  it('422 redirect_address_not_in_reply when the reply never contained the address', async () => {
    const { t, task } = await redirect();
    t.inbound.rows.get(t.msg.id)!.body = 'No address here.';
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['redirect_address_not_in_reply']);
  });
  it.each([[undefined], [''], ['   ']])('422 address_confirmation_required for confirmAddress %j', async (confirmAddress) => {
    const { t, task } = await redirect();
    await rejects(approveTask(task.id, t.deps, { confirmAddress }), 422, ['address_confirmation_required']);
    expect(t.tasks.rows.get(task.id)!.status).toBe('open');
  });
  it('422 address_confirmation_mismatch when the retyped address differs', async () => {
    const { t, task } = await redirect();
    await rejects(approveTask(task.id, t.deps, { confirmAddress: 'new@example.org' }), 422, ['address_confirmation_mismatch']);
  });
  it('treats a task with no redirect details as recipient_missing', async () => {
    const { t, task, row } = await redirect();
    row.details = undefined;
    await rejects(approveTask(task.id, t.deps, { confirmAddress: email }), 422, ['recipient_missing']);
  });
  it('accepts a case-insensitive confirmation and stores evidence on the done task', async () => {
    const { t, task } = await redirect();
    await approveTask(task.id, t.deps, { confirmAddress: '  NEW@Example.com ' });
    const done = t.tasks.rows.get(task.id)!;
    expect(done.status).toBe('done');
    expect(done.details).toMatchObject({ evidence: { claimType: 'contact_point.email.inbound_reply', claim: email } });
  });
});

describe('addressInText', () => {
  it.each([
    ['empty address', '', 'a@b.com', false],
    ['whole token', 'a@b.com', 'write to A@B.com today', true],
    ['trailing sentence period', 'a@b.com', 'email a@b.com.', true],
    ['inside angle brackets', 'a@b.com', 'Name <a@b.com>', true],
    ['superstring local part', 'a@b.com', 'xa@b.com', false],
    ['superstring domain', 'a@b.com', 'a@b.com.evil.io', false],
    ['token split across newline', 'a@b.com', 'a@b\n.com', false],
  ])('%s', (_n, address, body, expected) => {
    expect(addressInText(address, body)).toBe(expected);
  });
});

describe('inboundReplyContactPoint', () => {
  it('uses the supplied receivedAt as fetchedAt', () => {
    const cp = inboundReplyContactPoint({ channel: 'email', address: 'a@b.com', messageId: 'm1', receivedAt: '2026-01-01T00:00:00Z' });
    expect(cp).toMatchObject({ fetchedAt: '2026-01-01T00:00:00Z', sourceUrl: 'urn:wayfinder:message:m1', id: 'contact_point:inbound_reply:a@b.com:m1' });
  });
  it('falls back to the current time when receivedAt is omitted', () => {
    const cp = inboundReplyContactPoint({ channel: 'email', address: 'a@b.com', messageId: 'm1' });
    expect(Number.isNaN(Date.parse(cp.fetchedAt))).toBe(false);
  });
});

describe('inboxHandlers error mapping', () => {
  const req = (body: string) => new Request('http://x.test/api', { method: 'POST', body });
  it('maps a non-OutreachError to a 503 with a generic reason and logs only the error name', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    t.tasks.task = async () => { throw new TypeError('secret detail'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await inboxHandlers(t.deps).approve(req(''), task.id);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reasons: ['tasks_unavailable'] });
    expect(spy).toHaveBeenCalledWith('Task operation failed:', 'TypeError');
    spy.mockRestore();
  });
  it('logs "unknown" when a non-Error value is thrown', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    t.tasks.task = async () => { throw 'boom'; };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await inboxHandlers(t.deps).approve(req(''), task.id);
    expect(res.status).toBe(503);
    expect(spy).toHaveBeenCalledWith('Task operation failed:', 'unknown');
    spy.mockRestore();
  });
  it('400s on malformed JSON, a bad uuid, and an oversized confirmAddress', async () => {
    const t = setup(); const h = inboxHandlers(t.deps);
    expect((await h.approve(req('{nope'), id())).status).toBe(400);
    expect((await h.approve(req('{}'), 'not-a-uuid')).status).toBe(400);
    expect((await h.approve(req(JSON.stringify({ confirmAddress: 'a'.repeat(321) })), id())).status).toBe(400);
  });
  it('treats a JSON null body as empty input', async () => {
    const t = setup(); const task = await t.make({ class: 'unclear' });
    expect((await inboxHandlers(t.deps).approve(req('null'), task.id)).status).toBe(200);
  });
  it('get 404s for an unknown task and returns the task as-is for non-redirects', async () => {
    const t = setup(); const h = inboxHandlers(t.deps);
    expect((await h.get(new Request('http://x.test'), id())).status).toBe(404);
    const task = await t.make({ class: 'unclear' });
    expect(await (await h.get(new Request('http://x.test'), task.id)).json()).toMatchObject({ task: { id: task.id } });
  });
  it('get on a redirect returns the normalized confirm address and quote, or nulls when absent', async () => {
    const t = setup(); const h = inboxHandlers(t.deps);
    const task = await t.make({ class: 'redirect', redirect: { email: 'New@Example.com' } });
    const body = await (await h.get(new Request('http://x.test'), task.id)).json() as { confirm: { address: string; quote: unknown } };
    expect(body.confirm.address).toBe('new@example.com');
    t.tasks.rows.get(task.id)!.details = undefined;
    const bare = await (await h.get(new Request('http://x.test'), task.id)).json() as { confirm: { address: unknown; quote: unknown } };
    expect(bare.confirm).toEqual({ address: null, quote: null });
  });
});
