import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadResources } from '@/components/coordinate/client';

afterEach(() => vi.unstubAllGlobals());

describe('coordinate loadResources', () => {
  it('peeks at the plan with ?optional=1 and reads { plan: null } as no resources yet', async () => {
    const f = vi.fn(async (u: string) => { void u; return new Response(JSON.stringify({ plan: null }), { status: 200 }); });
    vi.stubGlobal('fetch', f);
    expect(await loadResources('c1')).toEqual({ ok: true, data: [] });
    expect(f.mock.calls[0][0]).toBe('/api/cases/c1/plan?optional=1');
  });
  it('maps plan resources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan: { resources: [{ resourceKey: 'expert:e1', name: 'Dr A', contactId: null, steps: [] }] } }), { status: 200 })));
    expect(await loadResources('c1')).toEqual({ ok: true, data: [{ resourceKey: 'expert:e1', name: 'Dr A', contactId: null }] });
  });
});
