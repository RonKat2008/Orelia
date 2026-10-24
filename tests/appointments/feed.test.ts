import { describe, expect, it } from 'vitest';
import { feedIsLive, signFeedToken, verifyFeedToken } from '@/lib/appointments/feed';
import { MemoryAppointmentStore } from '@/lib/appointments/store';

const env = { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
const otherEnv = { WAYFINDER_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64') };
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('feed tokens', () => {
  it('round-trips with and without the .ics suffix', () => {
    const token = signFeedToken(ID, env);
    expect(verifyFeedToken(token, env)).toBe(ID);
    expect(verifyFeedToken(`${token}.ics`, env)).toBe(ID);
    expect(verifyFeedToken(`${token}.ICS`, env)).toBe(ID);
  });

  it('refuses to sign a non-uuid id', () => {
    expect(() => signFeedToken('not-a-uuid', env)).toThrow();
  });

  it('rejects a tampered signature', () => {
    const token = signFeedToken(ID, env);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyFeedToken(tampered, env)).toBeNull();
  });

  it('rejects another id carrying a copied signature', () => {
    const sig = signFeedToken(ID, env).slice(ID.length + 1);
    expect(verifyFeedToken(`${OTHER_ID}.${sig}`, env)).toBeNull();
  });

  it.each(['', '.', 'abc', `${ID}`, `${ID}.`, `.sig`, 'not-a-uuid.sig', `${ID}.${'x'.repeat(65)}`])('rejects malformed token %j', token => {
    expect(verifyFeedToken(token, env)).toBeNull();
  });

  it('rejects a well-formed signature under a different key', () => {
    expect(verifyFeedToken(signFeedToken(ID, otherEnv), env)).toBeNull();
  });

  it('normalizes the id to lowercase', () => {
    const upper = ID.toUpperCase();
    // The signature covers the exact id string, so sign the upper-case form and expect a lower-case id back.
    expect(verifyFeedToken(signFeedToken(upper, env), env)).toBe(ID);
  });
});

describe('feed lifecycle', () => {
  it('is live only while it exists and is not revoked', () => {
    expect(feedIsLive(undefined)).toBe(false);
    expect(feedIsLive({ id: ID, ownerKey: 'a', revokedAt: null, createdAt: 'x' })).toBe(true);
    expect(feedIsLive({ id: ID, ownerKey: 'a', revokedAt: '2026-10-24T00:00:00Z', createdAt: 'x' })).toBe(false);
  });

  it('MemoryAppointmentStore.revokeFeed works only for the owner and only once', async () => {
    const store = new MemoryAppointmentStore();
    const feed = await store.createFeed('alice');
    expect(await store.revokeFeed(feed.id, 'bob', new Date())).toBe(false);
    expect(feedIsLive(await store.feed(feed.id))).toBe(true);
    expect(await store.revokeFeed(feed.id, 'alice', new Date())).toBe(true);
    expect(await store.revokeFeed(feed.id, 'alice', new Date())).toBe(false);
    expect(feedIsLive(await store.feed(feed.id))).toBe(false);
  });

  it('lists feeds per owner', async () => {
    const store = new MemoryAppointmentStore();
    await store.createFeed('alice');
    await store.createFeed('bob');
    expect(await store.feeds('alice')).toHaveLength(1);
  });
});
