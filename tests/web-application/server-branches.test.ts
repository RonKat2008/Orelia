import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  submitGated: vi.fn(),
  getCase: vi.fn(async () => ({ diseaseName: 'x' })),
  consent: vi.fn(async () => ({ contactId: 'c', sharedFields: [], approvedAt: 'z' })),
  contacts: vi.fn(async () => [{ id: 'c' }]),
}));
vi.mock('../../lib/plan/channels', () => ({ getWebFormChannel: () => ({ submitGated: h.submitGated }) }));
vi.mock('../../lib/outreach/postgres-store', () => ({ PostgresOutreachStore: class { getCase = h.getCase; consent = h.consent; contacts = h.contacts; } }));

import { defaultApproveDeps } from '../../lib/web-application/server';

describe('defaultApproveDeps', () => {
  const g = globalThis as unknown as { __wayfinderApplications?: unknown };
  beforeEach(() => { delete g.__wayfinderApplications; vi.stubEnv('WAYFINDER_OFFLINE', '1'); h.submitGated.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); delete g.__wayfinderApplications; });

  it('answers empty without a database and never loads the Postgres store', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const deps = defaultApproveDeps();
    expect(await deps.outreach.getCase('case')).toBeUndefined();
    expect(await deps.outreach.consent('c')).toBeUndefined();
    expect(await deps.outreach.contacts('case')).toEqual([]);
    expect(h.getCase).not.toHaveBeenCalled();
  });
  it('delegates to the Postgres outreach store when a database url is set', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic.invalid/db');
    const deps = defaultApproveDeps();
    expect(await deps.outreach.getCase('case')).toEqual({ diseaseName: 'x' });
    expect((await deps.outreach.consent('c'))?.approvedAt).toBe('z');
    expect(await deps.outreach.contacts('case')).toHaveLength(1);
  });
  it('submits through the web-form channel and throws when the channel is unavailable', async () => {
    const deps = defaultApproveDeps();
    h.submitGated.mockResolvedValueOnce({ ok: true, status: 'submitted' });
    await expect(deps.submit({} as never)).resolves.toBeUndefined();
    h.submitGated.mockResolvedValueOnce({ ok: false, status: 'not_available', reason: 'x' });
    await expect(deps.submit({} as never)).rejects.toThrow('web form channel unavailable');
  });
});
