import { describe, expect, it } from 'vitest';
import { planRegistration } from '../../scripts/register-webhooks-plan';

describe('planRegistration', () => {
  const url = 'https://app.example/api/webhooks/agentmail';
  it('creates when the URL is new', () => {
    expect(planRegistration({ provider: 'agentmail', url, events: ['message.received'], existing: [] }).action).toBe('create');
  });
  it('reuses an AgentMail webhook that already has the events', () => {
    const plan = planRegistration({ provider: 'agentmail', url, events: ['message.received'], existing: [{ webhook_id: 'wh_1', url, event_types: ['message.received'], enabled: true, secret: 'whsec_x' }] });
    expect(plan).toMatchObject({ action: 'reuse', id: 'wh_1', secret: 'whsec_x' });
  });
  it('updates AgentMail when message.received is missing', () => {
    const plan = planRegistration({ provider: 'agentmail', url, events: ['message.received'], existing: [{ webhook_id: 'wh_1', url, event_types: ['message.sent'], enabled: true }] });
    expect(plan.action).toBe('update');
  });
  it('replaces an AgentCall webhook whose events are short', () => {
    const plan = planRegistration({ provider: 'agentcall', url: 'https://app.example/api/webhooks/agentcall', events: ['call.status', 'call.transcript'], existing: [{ id: 'hk_1', url: 'https://app.example/api/webhooks/agentcall', events: ['call.status'] }] });
    expect(plan.action).toBe('replace');
  });
});
