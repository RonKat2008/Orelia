import { describe, expect, it } from 'vitest';
import type { HistoryShare } from '@/lib/history/contract';
import { MemoryShareStore, resolveShare, shareStatus, signShareToken } from '@/lib/history/share';
import { CASE_A, CASE_B, timeline } from './share-fixtures';

const env = { WAYFINDER_SHARE_SECRET: 's' };
const now = new Date('2026-10-24T10:00:00Z');
const share = (over: Partial<HistoryShare> = {}): HistoryShare => ({
  id: 'sh1', caseId: CASE_A, sections: ['diagnosis'], label: 'Dr. Lee', createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), revokedAt: null, ...over,
});
const loadTimeline = async () => timeline;

describe('MemoryShareStore', () => {
  it('revokes only within the owning case', async () => {
    const s = new MemoryShareStore();
    await s.create(share());
    expect(await s.revoke(CASE_B, 'sh1', now)).toBeUndefined();
    expect((await s.get('sh1'))?.revokedAt).toBeNull();
    expect((await s.revoke(CASE_A, 'sh1', now))?.revokedAt).toBe(now.toISOString());
  });
  it('lists only the case shares', async () => {
    const s = new MemoryShareStore();
    await s.create(share());
    await s.create(share({ id: 'sh2', caseId: CASE_B }));
    expect((await s.list(CASE_A)).map(x => x.id)).toEqual(['sh1']);
  });
});

describe('shareStatus', () => {
  it('computes active / expired / revoked', () => {
    expect(shareStatus(share(), now)).toBe('active');
    expect(shareStatus(share({ expiresAt: now.toISOString() }), now)).toBe('expired');
    expect(shareStatus(share({ revokedAt: now.toISOString() }), now)).toBe('revoked');
  });
});

describe('resolveShare', () => {
  const tokenFor = (id = 'sh1') => signShareToken(id, new Date(now.getTime() + 86_400_000), env);

  it('returns a summary restricted to the ticked sections for an active link', async () => {
    const store = new MemoryShareStore();
    await store.create(share());
    const r = await resolveShare(tokenFor(), now, { store, env, loadTimeline });
    expect(r?.summary.sections.map(s => s.key)).toEqual(['diagnosis']);
    expect(JSON.stringify(r?.summary)).not.toContain('charlie');
  });
  it('loads the timeline of the share\'s own case', async () => {
    const store = new MemoryShareStore();
    await store.create(share({ caseId: CASE_B }));
    const seen: string[] = [];
    await resolveShare(tokenFor(), now, { store, env, loadTimeline: async c => { seen.push(c); return timeline; } });
    expect(seen).toEqual([CASE_B]);
  });
  it('returns null when revoked, expired by row, unknown, or token expired/invalid', async () => {
    const store = new MemoryShareStore();
    await store.create(share({ id: 'rev', revokedAt: now.toISOString() }));
    await store.create(share({ id: 'old', expiresAt: new Date(now.getTime() - 1).toISOString() }));
    const deps = { store, env, loadTimeline };
    expect(await resolveShare(tokenFor('rev'), now, deps)).toBeNull();
    expect(await resolveShare(tokenFor('old'), now, deps)).toBeNull();
    expect(await resolveShare(tokenFor('missing'), now, deps)).toBeNull();
    expect(await resolveShare('garbage', now, deps)).toBeNull();
    await store.create(share());
    expect(await resolveShare(tokenFor(), new Date(now.getTime() + 2 * 86_400_000), deps)).toBeNull();
  });
});
