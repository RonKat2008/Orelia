import { describe, expect, it } from 'vitest';
import { MemoryPlanStore } from '@/lib/plan/store';
import { makePlan } from './plan-fixture';

describe('MemoryPlanStore', () => {
  it('returns null when empty and round-trips a saved plan', async () => {
    const s = new MemoryPlanStore();
    expect(await s.latest('c1')).toBeNull();
    const saved = await s.save(makePlan('c1'));
    expect(saved?.version).toBe(1);
    expect(await s.latest('c1')).toEqual(makePlan('c1'));
  });

  it('enforces optimistic version checks', async () => {
    const s = new MemoryPlanStore();
    await s.save(makePlan('c1'));
    expect(await s.save(makePlan('c1', { version: 2 }), 5)).toBeNull();
    expect((await s.latest('c1'))?.version).toBe(1);
    expect((await s.save(makePlan('c1', { version: 2 }), 1))?.version).toBe(2);
    expect(await s.save(makePlan('nope', { version: 2 }), 1)).toBeNull();
  });

  it('is immutable to callers on both save and read', async () => {
    const s = new MemoryPlanStore();
    const plan = makePlan('c1');
    await s.save(plan);
    plan.resources[0].steps[0].enabled = false;
    const read = await s.latest('c1');
    expect(read?.resources[0].steps[0].enabled).toBe(true);
    read!.resources[0].steps[0].enabled = false;
    expect((await s.latest('c1'))?.resources[0].steps[0].enabled).toBe(true);
  });

  it('rejects an invalid plan', async () => {
    const s = new MemoryPlanStore();
    expect(await s.save({ ...makePlan('c1'), version: 0 })).toBeNull();
  });
});
