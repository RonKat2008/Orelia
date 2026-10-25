/**
 * Each ResourceAgent gets its OWN AgentMail inbox at spawn (idempotent: clientId = wayfinder-agent-<agentId>, so a
 * retry returns the same inbox). If creation fails (plan inbox cap — the free plan allows 3 — or any provider error),
 * the agent falls back to the case's shared sender inbox, where its mail is kept apart by its own thread and its
 * `agent:<id>` / `contact:<id>` labels. The mode used is recorded on the agent and shown on its judge card.
 * Offline / no key: mode 'none' (mock mailer; routing is by thread only).
 */
import { AgentMailClient } from 'agentmail';
import type { InboxMode, ResourceAgent } from './types';

export interface AgentInbox { inboxId: string; email: string }
export interface InboxProvider {
  create(input: { clientId: string; username: string; displayName: string; metadata: Record<string, string> }): Promise<AgentInbox>;
}
export interface ProvisionResult { mode: InboxMode; inboxId: string | null; address: string | null; reason?: string }

type Env = Record<string, string | undefined>;
const isOffline = (env: Env) => ['1', 'true'].includes((env.WAYFINDER_OFFLINE ?? '').trim().toLowerCase());

export function inboxUsername(agent: Pick<ResourceAgent, 'caseId' | 'name' | 'id'>): string {
  const slug = agent.name.toLowerCase().replace(/\bagent\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'resource';
  return `wf-${agent.caseId.slice(0, 6)}-${slug}-${agent.id.slice(0, 4)}`;
}

export function agentMailInboxProvider(env: Env = process.env): InboxProvider | null {
  const key = env.AGENTMAIL_API_KEY?.trim();
  if (!key || isOffline(env)) return null;
  const client = new AgentMailClient({ apiKey: key });
  const domain = env.AGENTMAIL_INBOX_DOMAIN?.trim();
  return {
    async create(input) {
      const inbox = await client.inboxes.create({ ...input, ...(domain ? { domain } : {}) }, { maxRetries: 0 });
      return { inboxId: inbox.inboxId, email: inbox.email };
    },
  };
}

export async function provisionAgentInbox(
  agent: Pick<ResourceAgent, 'id' | 'caseId' | 'name' | 'inboxMode' | 'inboxId' | 'inboxAddress'>,
  deps: { provider: InboxProvider | null; sharedInboxId?: string | null },
): Promise<ProvisionResult> {
  if (agent.inboxMode === 'own' && agent.inboxId) return { mode: 'own', inboxId: agent.inboxId, address: agent.inboxAddress };
  if (!deps.provider) return { mode: 'none', inboxId: null, address: null, reason: 'email provider not configured (mock mailer)' };
  try {
    const made = await deps.provider.create({
      clientId: `wayfinder-agent-${agent.id}`, username: inboxUsername(agent), displayName: `Wayfinder for ${agent.name}`.slice(0, 60),
      metadata: { caseId: agent.caseId, agentId: agent.id },
    });
    return { mode: 'own', inboxId: made.inboxId, address: made.email };
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    return {
      mode: 'shared', inboxId: deps.sharedInboxId ?? null, address: deps.sharedInboxId ?? null,
      reason: status === 403 || status === 429 ? 'inbox limit reached; using the case inbox with a per-agent thread' : 'inbox could not be created; using the case inbox with a per-agent thread',
    };
  }
}

/**
 * Inbound email routing guard. A message on a known thread belongs to that thread's contact; when that contact's
 * agent owns a dedicated inbox, the message must have arrived in THAT inbox (else it is refused: never cross agents).
 * A message on an unknown thread that arrived in an agent's own inbox routes to that agent's contact.
 */
export function routeInboundEmail(input: {
  inboxId: string | undefined;
  threadOwner: { contactId: string; caseId: string } | undefined;
  ownerAgent: Pick<ResourceAgent, 'inboxMode' | 'inboxId'> | null;
  inboxAgent: Pick<ResourceAgent, 'contactId' | 'caseId' | 'inboxMode' | 'inboxId'> | null;
}): { contactId: string; caseId: string } | { refused: 'inbox_mismatch' | 'unknown' } {
  const { inboxId, threadOwner, ownerAgent, inboxAgent } = input;
  if (threadOwner) {
    if (ownerAgent?.inboxMode === 'own' && ownerAgent.inboxId && inboxId && inboxId !== ownerAgent.inboxId) return { refused: 'inbox_mismatch' };
    return threadOwner;
  }
  if (inboxAgent?.inboxMode === 'own' && inboxAgent.contactId && inboxId && inboxAgent.inboxId === inboxId) {
    return { contactId: inboxAgent.contactId, caseId: inboxAgent.caseId };
  }
  return { refused: 'unknown' };
}

const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
/**
 * All agents share the one outbound Vapi number. An INBOUND call to it is matched to an agent by the caller's number
 * against that agent's resource phone; no match (or several) => 'unmatched' (shown to the patient).
 */
export function matchInboundCall(fromNumber: string, agents: { id: string; resourcePhone: string | null }[]): string | 'unmatched' {
  const from = digits(fromNumber);
  if (from.length < 10) return 'unmatched';
  const hits = agents.filter(a => a.resourcePhone && digits(a.resourcePhone) === from);
  return hits.length === 1 ? hits[0].id : 'unmatched';
}
