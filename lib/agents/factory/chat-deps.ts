/** Postgres wiring for agent chat, patient updates (digest) and patient email replies. Nothing here sends to a resource. */
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import { withDisclosure } from '../../safety/disclosure';
import { isAllowed, parseAllowlist } from '../../safety/allowlist';
import { isQuietHours } from '../../notify/quiet-hours';
import { notifyMode } from '../../notify/service';
import { noticeHasHealthDetails } from '../../notify/compose';
import { defaultLlm, handleChat, type ChatDeps, type ChatMessage, type ChatStore } from './chat';
import { observeAgent, postgresEffects } from './default-deps';
import { composeDigest, handlePatientReply, shouldSendDigest, signAgentApproval, type PatientReplyDeps, type PendingUpdate } from './report';
import { getAgentStore } from './store';
import type { ResourceAgent } from './types';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? res : (res as { rows: Row[] }).rows) as Row[];
const q = (query: ReturnType<typeof sql>) => getDb().execute(query).then(rowsOf);
const iso = (v: unknown) => new Date(v as string).toISOString();

const toMsg = (r: Row): ChatMessage => ({
  id: String(r.id), agentId: r.agent_id ? String(r.agent_id) : null, caseId: String(r.case_id), role: r.role === 'user' ? 'user' : 'agent',
  body: String(r.body), via: r.via === 'email' ? 'email' : 'app', data: (r.data as Record<string, unknown> | null) ?? null, createdAt: iso(r.created_at),
});

export class PostgresChatStore implements ChatStore {
  async append(m: Omit<ChatMessage, 'id' | 'createdAt'>) {
    const rows = await q(sql`INSERT INTO agent_messages (agent_id, case_id, role, body, via, data)
      VALUES (${m.agentId}::uuid, ${m.caseId}::uuid, ${m.role}, ${m.body}, ${m.via}, ${m.data ? JSON.stringify(m.data) : null}::jsonb)
      RETURNING id, agent_id, case_id, role, body, via, data, created_at`);
    return toMsg(rows[0]);
  }
  async list(agentId: string, limit: number) {
    const rows = await q(sql`SELECT * FROM (SELECT id, agent_id, case_id, role, body, via, data, created_at FROM agent_messages
      WHERE agent_id = ${agentId}::uuid AND coalesce(data->>'kind', '') <> 'digest' ORDER BY created_at DESC LIMIT ${limit}) t ORDER BY created_at`);
    return rows.map(toMsg);
  }
}

/** UNAPPROVED email draft on the agent's own contact, through the outreach store (the approve route + gate send it). */
async function draftNote(agent: ResourceAgent, input: { subject: string; body: string }) {
  if (!agent.contactId) return { unavailable: 'this resource has no email thread' };
  const [c] = await q(sql`SELECT c.id, c.channel, c.address, c.state, (SELECT shared_fields FROM consents WHERE contact_id = c.id ORDER BY approved_at DESC NULLS LAST LIMIT 1) AS fields
    FROM contacts c WHERE c.id = ${agent.contactId}::uuid`);
  if (!c) return { unavailable: 'contact not found' };
  if (c.channel !== 'email') return { unavailable: 'this resource is reached by phone' };
  const { PostgresOutreachStore } = await import('../../outreach/postgres-store');
  const id = crypto.randomUUID();
  await new PostgresOutreachStore().saveDraft({
    id, contactId: String(c.id), caseId: agent.caseId, channel: 'email', address: String(c.address), subject: input.subject.slice(0, 120),
    body: withDisclosure(`Hello,\n\n${input.body}\n\nThank you.`), sharedFields: (c.fields as string[] | null) ?? [], approvedAt: null, sentAt: null, classification: 'agent_request',
  });
  return { contactId: String(c.id), draftId: id };
}

export function defaultChatDeps(): ChatDeps {
  return {
    store: getAgentStore(), messages: new PostgresChatStore(), observe: a => observeAgent(a),
    findDocuments: (a, query) => postgresEffects.findDocuments(a, { id: 'chat', kind: 'records', title: query, status: 'open' }),
    draftNote, llm: defaultLlm(),
  };
}

/** Queues a patient update (shown in the agent's chat, emailed in the next digest). */
export async function queueUpdate(agent: Pick<ResourceAgent, 'id' | 'caseId' | 'name'>, u: Omit<PendingUpdate, 'agentId' | 'agentName' | 'at'>): Promise<void> {
  await new PostgresChatStore().append({ agentId: agent.id, caseId: agent.caseId, role: 'agent', body: u.text, via: 'app', data: { notify: 'pending', urgent: u.urgent, ...(u.draft ? { draft: u.draft } : {}) } });
}

type Env = Record<string, string | undefined>;

/** Cron: per case, send one digest when due (urgent now, else at most every DIGEST_EVERY_MS). */
export async function sendDigests(env: Env = process.env, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  const inboxId = env.WAYFINDER_NOTIFY_INBOX_ID?.trim();
  const secret = env.WAYFINDER_NOTIFY_LINK_SECRET ?? '';
  const pendingRows = await q(sql`SELECT m.id, m.agent_id, m.case_id, m.body, m.data, m.created_at, a.name FROM agent_messages m JOIN resource_agents a ON a.id = m.agent_id
    WHERE m.data->>'notify' = 'pending' ORDER BY m.created_at LIMIT 200`);
  const byCase = new Map<string, Row[]>();
  for (const r of pendingRows) byCase.set(String(r.case_id), [...(byCase.get(String(r.case_id)) ?? []), r]);
  for (const [caseId, rows] of byCase) {
    const [c] = await q(sql`SELECT patient_email, patient_notify_opt_in, home_state,
      (SELECT max(created_at) FROM agent_messages WHERE case_id = ${caseId}::uuid AND data->>'kind' = 'digest') AS last_digest FROM cases WHERE id = ${caseId}::uuid`);
    const items: PendingUpdate[] = rows.map(r => {
      const d = (r.data ?? {}) as { urgent?: boolean; draft?: PendingUpdate['draft'] };
      return { agentId: String(r.agent_id), agentName: String(r.name), text: String(r.body), urgent: !!d.urgent, at: iso(r.created_at), ...(d.draft ? { draft: d.draft } : {}) };
    });
    const email = String(c?.patient_email ?? '').trim();
    const mode = notifyMode(env);
    const allowed = mode === 'prod' && env.OUTBOUND_ALLOW_REAL === 'true' ? true : isAllowed(email, parseAllowlist(env.OUTBOUND_ALLOWLIST ?? ''));
    if (!c?.patient_notify_opt_in || !email || !allowed || !inboxId || !env.AGENTMAIL_API_KEY || isQuietHours(now, (c.home_state as string | null) ?? null)
      || !shouldSendDigest(items, c.last_digest ? iso(c.last_digest) : null, now)) { out.skipped += 1; continue; }
    const codes = new Map<string, string>();
    if (secret) for (const i of items) if (i.draft) codes.set(i.draft.draftId, signAgentApproval({ agentId: i.agentId, draftId: i.draft.draftId, now, secret }));
    const digest = composeDigest(items, codes, `${(env.WAYFINDER_APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/cases/${caseId}/tracker`);
    if (noticeHasHealthDetails(digest.text)) { out.skipped += 1; continue; }
    const { AgentMailClient } = await import('agentmail');
    const res = await new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY }).inboxes.messages.send(inboxId, { to: email, subject: digest.subject, text: digest.text, labels: ['wayfinder', 'agent-digest', `case:${caseId}`] }, { maxRetries: 0 });
    await q(sql`INSERT INTO agent_messages (agent_id, case_id, role, body, via, data) VALUES (NULL, ${caseId}::uuid, 'agent', ${digest.subject}, 'email',
      ${JSON.stringify({ kind: 'digest', threadId: res.threadId, messageId: res.messageId, items: rows.length })}::jsonb)`);
    await q(sql`UPDATE agent_messages SET data = data || '{"notify":"sent"}'::jsonb WHERE id = ANY(${rows.map(r => String(r.id))}::uuid[])`);
    out.sent += 1;
  }
  return out;
}

/** The case whose digest thread this is (patient replies arrive on it). */
export async function digestThreadCase(threadId: string): Promise<string | null> {
  const [r] = await q(sql`SELECT case_id FROM agent_messages WHERE data->>'kind' = 'digest' AND data->>'threadId' = ${threadId} LIMIT 1`);
  return r ? String(r.case_id) : null;
}

export function patientReplyDeps(env: Env = process.env): PatientReplyDeps {
  return {
    secret: env.WAYFINDER_NOTIFY_LINK_SECRET ?? '',
    async verifiedEmail(caseId) {
      try {
        const [r] = await q(sql`SELECT u.email FROM cases c JOIN neon_auth."user" u ON u.id::text = c.account_id WHERE c.id = ${caseId}::uuid AND coalesce(u."emailVerified", false) = true`);
        return r?.email ? String(r.email) : null;
      } catch { return null; }
    },
    agents: async caseId => (await getAgentStore().listByCase(caseId)).map(a => ({ id: a.id, name: a.name, contactId: a.contactId })),
    async consume(jti, agentId, draftId) {
      const rows = await q(sql`INSERT INTO agent_approval_tokens (jti, agent_id, draft_id) VALUES (${jti}, ${agentId}::uuid, ${draftId}::uuid) ON CONFLICT DO NOTHING RETURNING jti`);
      return rows.length === 1;
    },
    async draftContact(agentId, draftId) {
      const [r] = await q(sql`SELECT m.contact_id FROM messages m JOIN resource_agents a ON a.contact_id = m.contact_id
        WHERE m.id = ${draftId}::uuid AND a.id = ${agentId}::uuid AND m.direction = 'outbound' AND m.approved_at IS NULL AND m.sent_at IS NULL`);
      return r ? String(r.contact_id) : null;
    },
    async approve(contactId, draftId) {
      const { getOutreachHandlers } = await import('../../outreach/server');
      const req = new Request('http://internal/approve', { method: 'POST', body: JSON.stringify({ draftId }), headers: { 'content-type': 'application/json' } });
      const res = await getOutreachHandlers().approve(req, contactId);
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => ({})) as { reasons?: string[]; error?: string };
      return { ok: false, reasons: body.reasons ?? [body.error ?? `status ${res.status}`] };
    },
    async chat(agentId, text) { await handleChat(agentId, text, defaultChatDeps(), 'email'); },
  };
}

export async function handleDigestReply(input: { threadId: string; from: string; body: string }) {
  const caseId = await digestThreadCase(input.threadId);
  if (!caseId) return { ignored: 'unknown_thread' as const };
  return handlePatientReply({ caseId, from: input.from, body: input.body }, patientReplyDeps());
}
