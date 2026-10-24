/** Pure planning for scripts/register-webhooks.ts. No network. */

export const MAIL_EVENTS = ['message.received'] as const;
export const CALL_EVENTS = ['call.status', 'call.transcript'] as const;

export interface WebhookRecord {
  webhook_id?: string;
  id?: string;
  url?: string;
  secret?: string;
  event_types?: string[];
  events?: string[];
  enabled?: boolean;
}

export interface RegistrationPlan {
  provider: 'agentmail' | 'agentcall';
  action: 'reuse' | 'create' | 'update' | 'replace';
  url: string;
  events: readonly string[];
  id?: string;
  secret?: string;
  note?: string;
}

export function planRegistration(input: {
  provider: 'agentmail' | 'agentcall';
  url: string;
  events: readonly string[];
  existing: readonly WebhookRecord[];
}): RegistrationPlan {
  const match = input.existing.find(row => row.url === input.url);
  const base = { provider: input.provider, url: input.url, events: input.events };
  if (!match) return { ...base, action: 'create' };
  const id = match.webhook_id ?? match.id;
  const have = new Set(match.event_types ?? match.events ?? []);
  const missing = input.events.filter(event => !have.has(event));
  if (missing.length === 0 && match.enabled !== false) {
    return { ...base, action: 'reuse', ...(id ? { id } : {}), ...(match.secret ? { secret: match.secret } : {}) };
  }
  if (input.provider === 'agentmail') {
    return { ...base, action: 'update', ...(id ? { id } : {}), note: missing.length ? `replace event_types; missing ${missing.join(',')}` : 're-enable' };
  }
  return { ...base, action: 'replace', ...(id ? { id } : {}), note: 'AgentCall has no webhook update; delete then create (secret rotates)' };
}
