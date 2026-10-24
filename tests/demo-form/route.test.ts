import { beforeEach, describe, expect, it, vi } from 'vitest';

let selects: unknown[][] = [];
const inserted: unknown[] = [];
function chain(kind: 'select' | 'insert') {
  const c: Record<string, unknown> = {
    from: () => c, where: () => c, limit: () => c,
    values: (v: unknown) => { inserted.push(v); return c; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(kind === 'select' ? (selects.shift() ?? []) : []).then(res, rej),
  };
  return c;
}
vi.mock('@/db/client', () => ({ getDb: () => ({ select: () => chain('select'), insert: () => chain('insert') }) }));

import { POST } from '@/app/api/demo-intake/[resource]/route';
import { demoFormToken } from '@/lib/outreach/demo-destinations';

const CASE = '11111111-1111-4111-8111-111111111111';
const APP = 'abcdef12-1111-4111-8111-111111111111';
const SEG = 'organization-22222222-2222-4222-8222-222222222222-0123abcd';
const env = () => process.env as Record<string, string | undefined>;

function req(token?: string) {
  const t = token ?? demoFormToken(env(), { caseId: CASE, applicationId: APP, resource: SEG });
  const body = new URLSearchParams({ first_name: 'Pat', last_name: 'Doe', date_of_birth: '1990-01-01', email: 'p@example.org', phone: '555-0100', diagnosis: 'Sarcoma', reason_for_visit: 'First visit' });
  return new Request(`http://localhost/api/demo-intake/${SEG}?case=${CASE}&app=${APP}&t=${t}`, { method: 'POST', body });
}
const call = (r: Request) => POST(r, { params: Promise.resolve({ resource: SEG }) });
const row = (status: string) => [{ id: APP, caseId: CASE, contactId: 'c1', status }];

beforeEach(() => {
  selects = []; inserted.length = 0;
  vi.stubEnv('WAYFINDER_DEMO_COORDINATORS', '1');
  vi.stubEnv('OUTBOUND_ALLOWLIST', 'coord@agentmail.to');
  vi.stubEnv('AGENTMAIL_SENDER_INBOX_ID', 'sender@agentmail.to');
});

describe('demo intake route', () => {
  it('404s when demo mode is off', async () => {
    vi.stubEnv('WAYFINDER_DEMO_COORDINATORS', '');
    expect((await call(req())).status).toBe(404);
  });
  it('403s on a bad token', async () => {
    expect((await call(req('0'.repeat(32)))).status).toBe(403);
  });
  it('409s for a draft application and records nothing', async () => {
    selects = [row('draft')];
    expect((await call(req())).status).toBe(409);
    expect(inserted).toHaveLength(0);
  });
  it('303s for an approved application and inserts the task once', async () => {
    selects = [row('approved'), []];
    const res = await call(req());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/demo/intake-form/${SEG}/submitted?ref=abcdef12`);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ kind: 'application', status: 'done', sourceId: `demo_form:${APP}`, details: { fieldsReceived: ['first_name', 'last_name', 'date_of_birth', 'email', 'phone', 'diagnosis', 'reason_for_visit'] } });
    selects = [row('submitted'), [{ id: 't1' }]];
    expect((await call(req())).status).toBe(303);
    expect(inserted).toHaveLength(1);
  });
});
