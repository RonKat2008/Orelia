import { describe, expect, it, vi } from 'vitest';
import { selectChannels, vapiServerUrl, voiceProviderFor } from '../../lib/outreach/channel-wiring';
import { VapiChannel } from '../../lib/channels/vapi';
import { AgentCallChannel } from '../../lib/channels/agentcall';
import { MockCaller } from '../../lib/channels/mock-caller';
import { requirementsFor } from '../../lib/env';

const AC = { AGENTCALL_API_KEY: 'ac', AGENTCALL_FROM_NUMBER_ID: 'num_1' };
const VAPI = { VAPI_API_KEY: 'vk', VAPI_PHONE_NUMBER_ID: 'pn_1', VAPI_WEBHOOK_SECRET: 'sec' };
const voice = (env: Record<string, string>) => selectChannels({ OUTBOUND_ALLOWLIST: '+12025550123', ...env }).channels[1];

describe('voice provider selection', () => {
  it('keeps the current behaviour without Vapi keys', () => {
    expect(voiceProviderFor({})).toBe('agentcall');
    expect(voice(AC)).toBeInstanceOf(AgentCallChannel);
    expect(voice({})).toBeInstanceOf(MockCaller);
    expect(selectChannels(AC).providers.voice).toBe('agentcall');
  });

  it('picks Vapi automatically when VAPI_API_KEY and VAPI_PHONE_NUMBER_ID are set', () => {
    expect(voiceProviderFor({ VAPI_API_KEY: 'vk' })).toBe('agentcall');
    expect(voiceProviderFor(VAPI)).toBe('vapi');
    expect(voice({ ...AC, ...VAPI })).toBeInstanceOf(VapiChannel);
    expect(selectChannels({ ...AC, ...VAPI }).providers.voice).toBe('vapi');
  });

  it('VOICE_PROVIDER overrides the automatic choice', () => {
    expect(voice({ ...AC, ...VAPI, VOICE_PROVIDER: 'agentcall' })).toBeInstanceOf(AgentCallChannel);
    expect(voice({ ...AC, VOICE_PROVIDER: 'vapi' })).toBeInstanceOf(MockCaller);
    expect(voiceProviderFor({ VOICE_PROVIDER: 'VAPI' })).toBe('vapi');
    expect(voiceProviderFor({ VOICE_PROVIDER: 'bogus', ...VAPI })).toBe('vapi');
  });

  it('offline always uses the mock caller', () => {
    expect(voice({ ...VAPI, WAYFINDER_OFFLINE: '1' })).toBeInstanceOf(MockCaller);
  });

  it('sends the webhook URL and secret on each call', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'v1' })));
    const ch = selectChannels({ ...VAPI, WAYFINDER_APP_BASE_URL: 'https://app.example.test/' }, { fetcher: fetcher as unknown as typeof fetch }).channels[1];
    expect(ch).toBeInstanceOf(VapiChannel);
    expect(vapiServerUrl({ WAYFINDER_APP_BASE_URL: 'https://app.example.test/' })).toBe('https://app.example.test/api/webhooks/vapi');
    expect(vapiServerUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'wayfinder.example.test' })).toBe('https://wayfinder.example.test/api/webhooks/vapi');
    expect(vapiServerUrl({ WAYFINDER_APP_BASE_URL: 'http://localhost:3000' })).toBeUndefined();
    expect(vapiServerUrl({ VAPI_SERVER_URL: 'https://hook.example.test/v' })).toBe('https://hook.example.test/v');
  });

  it('env checks require all three Vapi vars once Vapi is in use', () => {
    const names = (env: Record<string, string>) => requirementsFor('prod', env).map(r => r.name);
    expect(names({})).not.toContain('VAPI_WEBHOOK_SECRET');
    expect(names({ VAPI_API_KEY: 'vk' })).toEqual(expect.arrayContaining(['VAPI_PHONE_NUMBER_ID', 'VAPI_WEBHOOK_SECRET']));
    expect(names({ VOICE_PROVIDER: 'vapi' })).toEqual(expect.arrayContaining(['VAPI_API_KEY', 'VAPI_PHONE_NUMBER_ID', 'VAPI_WEBHOOK_SECRET']));
  });
});
