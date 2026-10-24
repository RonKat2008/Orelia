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
const call = (body: BodyInit) => {
  const t = demoFormToken(env(), { caseId: CASE, applicationId: APP, resource: SEG });
  return POST(new Request(`http://localhost/api/demo-intake/${SEG}?case=${CASE}&app=${APP}&t=${t}`, { method: 'POST', body }), { params: Promise.resolve({ resource: SEG }) });
};

beforeEach(() => {
  selects = []; inserted.length = 0;
  vi.stubEnv('WAYFINDER_DEMO_COORDINATORS', '1');
  vi.stubEnv('OUTBOUND_ALLOWLIST', 'coord@agentmail.to');
  vi.stubEnv('AGENTMAIL_SENDER_INBOX_ID', 'sender@agentmail.to');
});

describe('demo intake form: required fields (marked * on the page)', () => {
  it.each([
    ['empty body', new URLSearchParams()],
    ['whitespace-only required fields', new URLSearchParams({ first_name: '   ', last_name: '\t', email: ' ', diagnosis: '\n' })],
    ['only unknown extra fields', new URLSearchParams({ '<script>x</script>': 'y', admin: 'true' })],
  ])('rejects a submission with missing required fields (%s) with a 4xx and records no "done" task', async (_label, body) => {
    selects = [[{ id: APP, caseId: CASE, contactId: 'c1', status: 'submitting' }], []];
    const res = await call(body);
    // BUG: 303 to /submitted and a status:'done' "received the application" task is inserted.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(inserted).toHaveLength(0);
  });
});
