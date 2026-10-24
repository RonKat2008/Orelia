import { afterEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => vi.fn(async () => ({ claimed: 2, processed: 1, stalled: 1, skipped: 0, failed: 0 })));
vi.mock('../../lib/workflows/follow-up-sweep', () => ({
  runFollowUpSweep: sweep,
  PostgresFollowUpSweepStore: class {},
}));
vi.mock('../../lib/workflows/default-deps', () => ({ createDefaultDeps: () => ({}) }));

import { GET } from '../../app/api/cron/follow-ups/route';

const req = (auth?: string) => new Request('http://x/api/cron/follow-ups', { headers: auth ? { authorization: auth } : {} });

afterEach(() => { vi.unstubAllEnvs(); sweep.mockClear(); });

describe('GET /api/cron/follow-ups auth', () => {
  it('rejects a missing header', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await GET(req())).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });
  it('rejects a wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect((await GET(req('s3cret'))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });
  it('fails closed when CRON_SECRET is unset, even for "Bearer undefined" or "Bearer "', async () => {
    vi.stubEnv('CRON_SECRET', '');
    for (const h of ['Bearer undefined', 'Bearer ', 'Bearer', undefined]) expect((await GET(req(h))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });
  it('runs the sweep with the right secret', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    const res = await GET(req('Bearer s3cret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, claimed: 2, stalled: 1 });
    expect(sweep).toHaveBeenCalledOnce();
  });
  it('does not sweep when Inngest owns the timers', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('INNGEST_EVENT_KEY', 'k');
    vi.stubEnv('INNGEST_SIGNING_KEY', 's');
    const res = await GET(req('Bearer s3cret'));
    expect(await res.json()).toMatchObject({ skipped: 'inngest_active' });
    expect(sweep).not.toHaveBeenCalled();
  });
});
