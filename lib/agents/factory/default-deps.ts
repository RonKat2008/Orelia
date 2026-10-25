/**
 * Postgres-backed effects for ResourceAgents, built on the existing machinery: OutreachService.draft (unapproved
 * drafts, consented fields only, AI disclosure), verification calls (wait for approval), the plan web-form channel
 * (fill, never submit), the walk-away follow-up cadence and the case document store. Nothing here can send.
 * Every query is scoped to the agent's own contact (or, for a web-only resource, its own plan URLs).
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import { search } from '../../case-docs';
import { getPlanStore } from '../../plan/store';
import { getWebFormChannel } from '../../plan/channels';
import { defaultCreateDraft, defaultCreateVerification } from '../../plan/materialize-wiring';
import { neutralizeUntrusted } from '../research/untrusted';
import { parseTimeScale } from '../../workflows/clock';
import { strategySteps, type Observation } from './policy';
import { getAgentStore } from './store';
import type { AgentEffects, CandidateDoc, StepDeps } from './step';
import type { ResourceAgent } from './types';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? res : (res as { rows: Row[] }).rows) as Row[];
const q = (query: ReturnType<typeof sql>) => getDb().execute(query).then(rowsOf);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export async function observeAgent(agent: ResourceAgent, now = new Date()): Promise<Observation> {
  const plan = await getPlanStore().latest(agent.caseId);
  const resource = plan?.resources.find(r => r.resourceKey === agent.resourceKey) ?? null;
  const webUrls = resource ? resource.steps.filter(s => s.channel === 'web_form').map(s => s.targetRef) : [];
  const cid = agent.contactId;
  const [contactRows, consentRows, messageRows, callRows, taskRows, appRows, verRows] = await Promise.all([
    cid ? q(sql`SELECT id, channel, state, first_sent_at, next_follow_up_at, follow_ups_sent FROM contacts WHERE id = ${cid}::uuid`) : Promise.resolve([]),
    cid ? q(sql`SELECT shared_fields, approved_at FROM consents WHERE contact_id = ${cid}::uuid ORDER BY approved_at DESC NULLS LAST LIMIT 1`) : Promise.resolve([]),
    cid ? q(sql`SELECT id, direction, channel, approved_at, sent_at, received_at, classification, CASE WHEN direction = 'inbound' THEN left(body, 1200) END AS body
               FROM messages WHERE contact_id = ${cid}::uuid ORDER BY coalesce(received_at, sent_at, approved_at) NULLS LAST LIMIT 40`) : Promise.resolve([]),
    cid ? q(sql`SELECT id, approved_at, started_at, ended_at, outcome, left(transcript, 1500) AS transcript FROM calls WHERE contact_id = ${cid}::uuid ORDER BY started_at NULLS LAST LIMIT 20`) : Promise.resolve([]),
    cid ? q(sql`SELECT id, kind, title, status FROM tasks WHERE contact_id = ${cid}::uuid ORDER BY id LIMIT 30`) : Promise.resolve([]),
    q(sql`SELECT id, url, status, approved_at, submitted_at FROM web_applications WHERE case_id = ${agent.caseId}::uuid
          AND (${cid ? sql`contact_id = ${cid}::uuid OR ` : sql``}(contact_id IS NULL AND url = ANY(${webUrls}::text[]))) LIMIT 10`),
    q(sql`SELECT count(*)::int AS n FROM verification_requests WHERE case_id = ${agent.caseId}::uuid AND resource_key = ${agent.resourceKey} AND status = 'awaiting_approval'`),
  ]);
  const c = contactRows[0];
  const consent = consentRows[0];
  return {
    now, scale: parseTimeScale(process.env.WAYFINDER_SIM_TIME_SCALE),
    contact: c ? { id: String(c.id), channel: c.channel as 'email' | 'voice', state: String(c.state), firstSentAt: iso(c.first_sent_at), nextFollowUpAt: iso(c.next_follow_up_at), followUpsSent: Number(c.follow_ups_sent ?? 0) } : null,
    // A web-only resource has no contact row; its application has its own consent review before submission.
    consent: cid ? { sharedFields: (consent?.shared_fields as string[] | undefined) ?? [], approved: !!consent?.approved_at } : { sharedFields: [], approved: true },
    plan: resource,
    messages: messageRows.map(m => ({ id: String(m.id), direction: m.direction === 'inbound' ? 'inbound' : 'outbound', channel: m.channel as 'email' | 'voice', approvedAt: iso(m.approved_at), sentAt: iso(m.sent_at), receivedAt: iso(m.received_at), classification: (m.classification as string | null) ?? null, ...(m.body ? { body: neutralizeUntrusted(String(m.body)) } : {}) })),
    calls: callRows.map(r => ({ id: String(r.id), approvedAt: iso(r.approved_at), startedAt: iso(r.started_at), endedAt: iso(r.ended_at), outcome: (r.outcome as string | null) ?? null, transcript: r.transcript ? neutralizeUntrusted(String(r.transcript)) : null })),
    applications: appRows.map(r => ({ id: String(r.id), url: String(r.url), status: String(r.status), approvedAt: iso(r.approved_at), submittedAt: iso(r.submitted_at) })),
    tasks: taskRows.map(r => ({ id: String(r.id), kind: String(r.kind), title: (r.title as string | null) ?? null, status: String(r.status) })),
    pendingVerifications: Number(verRows[0]?.n ?? 0),
  };
}

export const postgresEffects: AgentEffects = {
  observe: agent => observeAgent(agent),
  draftMessage: (_agent, contactId) => defaultCreateDraft(contactId),
  async prepareCall(agent, o) {
    if (o.contact?.channel === 'voice' && o.contact.state === 'drafted') return defaultCreateDraft(o.contact.id);
    const hasVoice = !!o.plan?.steps.some(s => s.enabled && s.channel === 'voice');
    if (!hasVoice) return { unavailable: 'no verified phone number for this resource' };
    try {
      return await defaultCreateVerification({ caseId: agent.caseId, resourceKey: agent.resourceKey });
    } catch (err) {
      const reason = (err as { reasons?: string[] })?.reasons?.[0];
      return { unavailable: reason ?? 'call could not be prepared' };
    }
  },
  async fillWeb(agent, url) {
    const r = await getWebFormChannel().draftFill({ caseId: agent.caseId, contactId: agent.contactId, url, resourceKey: agent.resourceKey });
    return r.ok ? { ok: true, id: r.draft.applicationId } : { ok: false, reason: r.reason };
  },
  async followUp(_agent, contactId) {
    const rows = await q(sql`SELECT approved_at FROM messages WHERE contact_id = ${contactId}::uuid AND direction = 'outbound' AND classification LIKE 'follow_up_%' AND sent_at IS NULL LIMIT 1`);
    if (rows[0]?.approved_at) return 'pre-approved walk-away follow-up goes out on schedule';
    if (rows[0]) return 'follow-up draft is waiting for the patient to approve it';
    return 'the cadence sweep drafts this follow-up (pre-approved if walk-away is on)';
  },
  async findDocuments(agent, task) {
    const o = agent.contactId ? await q(sql`SELECT shared_fields FROM consents WHERE contact_id = ${agent.contactId}::uuid ORDER BY approved_at DESC NULLS LAST LIMIT 1`) : [];
    const fields = (o[0]?.shared_fields as string[] | undefined) ?? [];
    const hits = await search({ caseId: agent.caseId, contactId: agent.contactId ?? undefined, allowedFields: fields, query: task.title ?? task.kind, k: 8 }).catch(() => []);
    const caseDocs: CandidateDoc[] = hits.filter(h => h.sharedField).map(h => ({ id: h.id, title: h.title, source: 'case', sharedField: h.sharedField, shareable: true }));
    const acct = await q(sql`SELECT d.id, d.title, d.share_with_resources AS shareable FROM account_documents d JOIN cases c ON c.account_id = d.account_id
                             WHERE c.id = ${agent.caseId}::uuid AND d.status = 'embedded' ORDER BY d.created_at DESC LIMIT 20`).catch(() => []);
    const accountDocs: CandidateDoc[] = acct.map(r => ({ id: String(r.id), title: String(r.title), source: 'account', sharedField: null, shareable: r.shareable === true }));
    const seen = new Set<string>();
    return [...caseDocs, ...accountDocs].filter(d => (seen.has(d.title) ? false : (seen.add(d.title), true)));
  },
  async attachAnswer(agent, task, docs) {
    if (!agent.contactId) return;
    const answer = { agentId: agent.id, docIds: docs.map(d => d.id), titles: docs.map(d => d.title).slice(0, 10), at: new Date().toISOString() };
    await q(sql`UPDATE tasks SET details = coalesce(details, '{}'::jsonb) || jsonb_build_object('agentAnswer', ${JSON.stringify(answer)}::jsonb)
                WHERE id = ${task.id}::uuid AND contact_id = ${agent.contactId}::uuid AND status = 'open'`);
  },
  async escalate(agent, reason) {
    if (!agent.contactId) return;
    const sourceId = `agent:${agent.id}:escalate`;
    await q(sql`INSERT INTO tasks (contact_id, case_id, kind, title, details, source_id)
                SELECT ${agent.contactId}::uuid, ${agent.caseId}::uuid, 'unclear', ${`${agent.name} needs you`.slice(0, 120)}, ${JSON.stringify({ agentId: agent.id, reason: reason.slice(0, 280) })}::jsonb, ${sourceId}
                WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE source_id = ${sourceId} AND status = 'open')`);
  },
};

export function defaultAgentDeps(): StepDeps {
  return {
    store: getAgentStore(), effects: postgresEffects,
    report: async (agent, update) => { const { queueUpdate } = await import('./chat-deps'); await queueUpdate(agent, update); },
  };
}

export { strategySteps };
