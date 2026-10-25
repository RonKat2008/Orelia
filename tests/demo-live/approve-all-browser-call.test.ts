import { describe, expect, it } from 'vitest';
import { approveAll, type FetchFn } from '@/lib/demo-live/approve-all';
import { PHONE_LINE_UNAVAILABLE } from '@/lib/channels/vapi-limits';

const CASE = 'case-1';
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeRoutes(approve: () => Response): FetchFn {
  return async (path) => {
    if (path.startsWith(`/api/cases/${CASE}/plan`)) return res({ plan: { version: 1, status: 'approved', resources: [{ contactId: 'call-1', steps: [{ channel: 'voice', enabled: true }] }] } });
    if (path === `/api/cases/${CASE}/contacts`) return res({ contacts: [{ id: 'call-1', displayName: 'Fictional Clinic', channel: 'voice', state: 'drafted', consented: true, approved: false }] });
    if (path === '/api/contacts/call-1/drafts') return res({ id: 'draft-1' });
    if (path === '/api/contacts/call-1/approve') return approve();
    if (path === `/api/cases/${CASE}/applications`) return res({ applications: [] });
    return res({}, 404);
  };
}

describe('approveAll: phone line unavailable', () => {
  it('marks a Vapi daily-limit rejection with a friendly reason and the browser-call offer', async () => {
    const items = await approveAll(CASE, fakeRoutes(() => res({ reasons: ['send_rejected'], detail: "vapi: HTTP 422 call.start.error-vapi-number-outbound-daily-limit. Couldn't Start Call. Numbers Bought On Vapi Have A Daily Outbound Call Limit." }, 502)));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ok: false, label: 'Call: Fictional Clinic', browserCall: { contactId: 'call-1' } });
    expect(items[0]!.detail.startsWith(PHONE_LINE_UNAVAILABLE)).toBe(true);
    expect(items[0]!.detail).toMatch(/daily outbound call limit/i);
  });

  it('other call rejections keep their reasons and get no browser offer', async () => {
    const items = await approveAll(CASE, fakeRoutes(() => res({ reasons: ['send_rejected'], detail: 'vapi: HTTP 400. Invalid number' }, 502)));
    expect(items[0]).toMatchObject({ ok: false, detail: 'send_rejected: vapi: HTTP 400. Invalid number' });
    expect(items[0]!.browserCall).toBeUndefined();
  });

  it('a placed call is unchanged', async () => {
    const items = await approveAll(CASE, fakeRoutes(() => res({ draftId: 'draft-1' })));
    expect(items[0]).toMatchObject({ ok: true, detail: 'call placed' });
  });
});
