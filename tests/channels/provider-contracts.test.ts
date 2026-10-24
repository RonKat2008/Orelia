import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeTurns } from '../../lib/channels/agentcall';

function load(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('recorded read-only provider responses', () => {
  it('AgentMail list inboxes and webhooks use the documented envelopes', () => {
    const inboxes = load('fixtures/api/agentmail/list-inboxes.json');
    const webhooks = load('fixtures/api/agentmail/list-webhooks.json');
    expect(inboxes).toMatchObject({ count: expect.any(Number), inboxes: expect.any(Array) });
    const first = (inboxes.inboxes as Record<string, unknown>[])[0]!;
    expect(first).toEqual(expect.objectContaining({ inbox_id: expect.any(String), email: expect.any(String), pod_id: expect.any(String) }));
    expect(webhooks).toEqual(expect.objectContaining({ count: 0, webhooks: [] }));
  });

  it('AgentCall list endpoints and voices match the live account', () => {
    expect(load('fixtures/api/agentcall/list-calls.json')).toEqual({ data: [], hasMore: false, nextCursor: null });
    expect(load('fixtures/api/agentcall/list-webhooks.json')).toEqual({ data: [] });
    const numbers = load('fixtures/api/agentcall/list-numbers.json');
    const number = (numbers.data as Record<string, unknown>[])[0]!;
    expect(number.id).toEqual(expect.any(String));
    expect(String(number.id).startsWith('num_')).toBe(false);
    expect(number).toEqual(expect.objectContaining({ number: '+15555550100', status: 'active', type: 'local' }));
    const voices = load('fixtures/api/agentcall/voices.json');
    expect(voices.defaultVoice).toBe('shimmer');
    expect((voices.voices as { id: string }[]).map(v => v.id)).toEqual(expect.arrayContaining(['alloy', 'shimmer']));
    expect(voices.pricing).toEqual({ outboundAiVoice: '$0.40/minute', inboundAiVoice: '$0.40/minute' });
    expect(load('fixtures/api/agentcall/account.json')).toEqual(expect.objectContaining({ plan: 'free', offerVersion: 'live_trial_72h_v1' }));
  });

  it('maps the documented transcript GET body', () => {
    const body = load('fixtures/api/agentcall/transcript-documented.json');
    expect(normalizeTurns(body)).toEqual([
      { role: 'ai', text: 'Hi, this is an automated assistant.', timestamp: '2026-05-13T14:30:00.000Z' },
      { role: 'human', text: 'Front desk speaking.', timestamp: '2026-05-13T14:30:04.000Z' },
    ]);
  });
});
