import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AgentCallChannel, normalizeTurns, parseAgentCallWebhook, verifyAgentCallSignature } from '../../lib/channels/agentcall';
import { guard, gatedCall } from './helpers';

const secret = 'synthetic-webhook-secret';
const headers = (body: string) => ({ 'X-AgentCall-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` });
function channel(response: Response) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response.clone());
  return { fetcher, adapter: new AgentCallChannel({ apiKey: 'synthetic-key', fromNumberId: 'synthetic-number', guard, fetcher, baseUrl: 'https://voice.example.test///' }) };
}

describe('voice provider malformed responses', () => {
  it.each(['', 'plain text', 'null', '42', '"string"'])('refuses successful send without a call identifier: %s', body => {
    const { adapter } = channel(new Response(body));
    return expect(adapter.send(gatedCall())).rejects.toMatchObject({ provider: 'agentcall', retryable: false, message: expect.stringContaining('call id') });
  });
  it('retains a non-JSON HTTP error body and marks throttling retryable', async () => {
    const { adapter } = channel(new Response('provider busy', { status: 429 }));
    await expect(adapter.getCall('synthetic')).rejects.toMatchObject({ status: 429, retryable: true, body: 'provider busy' });
  });
  it('uses the requested call identifier when lookup response omits it and encodes the URL', async () => {
    const { adapter, fetcher } = channel(new Response('{}'));
    expect(await adapter.getCall('call/with spaces')).toEqual({ callId: 'call/with spaces' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://voice.example.test/v1/calls/call%2Fwith%20spaces');
  });
  it('scrubs every occurrence of the API key in transport failures', async () => {
    const adapter = new AgentCallChannel({ apiKey: 'synthetic-key', fromNumberId: 'n', guard, fetcher: vi.fn(async () => { throw new Error('synthetic-key twice synthetic-key'); }) });
    await expect(adapter.getCall('c')).rejects.toMatchObject({ retryable: true, message: 'agentcall: Network error: [redacted] twice [redacted]' });
  });
});

describe('voice inbound boundary cases', () => {
  it('drops malformed transcript entries and preserves only string timestamps', () => {
    expect(normalizeTurns([null, 42, 'text', {}, { role: 'ai', text: 7 }, { role: 'assistant', text: 'Hello', timestamp: 123 }, { role: 'user', text: 'Hi', timestamp: 't' }])).toEqual([{ role: 'ai', text: 'Hello' }, { role: 'human', text: 'Hi', timestamp: 't' }]);
    expect(normalizeTurns({})).toBeUndefined();
    expect(normalizeTurns({ entries: [] })).toEqual([]);
  });
  it('refuses an empty webhook secret', () => {
    expect(verifyAgentCallSignature('{}', headers('{}')['X-AgentCall-Signature'], '')).toBe(false);
  });
  it.each(['null', '[]', '{}', '{"event":1,"data":{"callId":"c"}}', '{"event":"call.status","data":{"callId":1}}'])('refuses signed malformed envelope before lookup: %s', async body => {
    const lookup = vi.fn(() => 'synthetic-contact');
    await expect(parseAgentCallWebhook(body, headers(body), secret, lookup)).rejects.toMatchObject({ status: 400 });
    expect(lookup).not.toHaveBeenCalled();
  });
  it('defaults missing transcripts to empty and missing timestamps to the receipt time', async () => {
    const body = JSON.stringify({ event: 'call.transcript', data: { callId: 'c' } });
    const before = Date.now();
    const result = await parseAgentCallWebhook(body, headers(body), secret, () => 'synthetic-contact');
    expect(result).toMatchObject({ body: '', status: 'completed', contactId: 'synthetic-contact' });
    expect(Date.parse(result.receivedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(result.receivedAt)).toBeLessThanOrEqual(Date.now());
  });
  it('omits non-string status in a known call status event', async () => {
    const body = JSON.stringify({ event: 'call.status', data: { callId: 'c', status: 42 } });
    const result = await parseAgentCallWebhook(body, headers(body), secret, () => 'synthetic-contact');
    expect(result).not.toHaveProperty('status');
    expect(result.body).toBe('');
  });
});
