/**
 * Agents report back while the patient is offline, and act on the patient's email replies.
 * - Meaningful moments (reply arrived, something needs approval, appointment offered, follow-up sent, stalled) are
 *   queued as agent messages (data.notify = 'pending'). A digest to the patient goes out at most every
 *   DIGEST_EVERY_MS, except urgent items (needs-you, appointment offered), which go at once. Notices carry no
 *   clinical text (noticeHasHealthDetails), the opt-in, allowlist and quiet hours rules of lib/notify still apply.
 * - Each pending draft in a digest gets a signed, single-use, short-lived APPROVE code tied to that agent and draft.
 *   A reply is acted on only when it comes from the patient's VERIFIED account email: APPROVE codes run the normal
 *   approve path (outbound gate); the rest of the text becomes a chat message to the agent. Anything else is ignored.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { noticeHasHealthDetails } from '../../notify/compose';
import { normalizeAddress } from '../../safety/allowlist';

export const DIGEST_EVERY_MS = 3 * 60 * 60 * 1000;
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingUpdate { agentId: string; agentName: string; text: string; urgent: boolean; at: string; draft?: { contactId: string; draftId: string; label: string } }

/** True when a digest should go now: something urgent, or the oldest pending item has waited a full digest window since the last digest. */
export function shouldSendDigest(pending: Pick<PendingUpdate, 'urgent' | 'at'>[], lastDigestAt: string | null, now: Date, everyMs = DIGEST_EVERY_MS): boolean {
  if (pending.length === 0) return false;
  if (pending.some(p => p.urgent)) return true;
  if (!lastDigestAt) return true;
  return now.getTime() - Date.parse(lastDigestAt) >= everyMs;
}

/** The label used in email: the agent's name unless it carries health words, then a neutral "Agent N". */
export function safeLabel(name: string, n: number): string {
  return noticeHasHealthDetails(name) ? `Agent ${n}` : name;
}

export function composeDigest(items: PendingUpdate[], codes: Map<string, string>, appUrl: string): { subject: string; text: string } {
  const names = [...new Set(items.map(i => i.agentName))];
  const lines = items.map(i => `- ${safeLabel(i.agentName, names.indexOf(i.agentName) + 1)}: ${i.text}`);
  const approvals = items.filter(i => i.draft && codes.has(i.draft.draftId)).map(i => `  To send "${i.draft!.label}" now, reply with: APPROVE ${codes.get(i.draft!.draftId)}`);
  const text = [
    'Updates from your Wayfinder agents:', ...lines, '',
    ...(approvals.length ? ['Quick approvals (each code works once, for 24 hours, only from your account email):', ...approvals, ''] : []),
    'You can also reply in plain words to answer an agent or give it an instruction (start with the agent name if you have several).',
    `Open Wayfinder: ${appUrl}`,
  ].join('\n');
  return { subject: items.some(i => i.urgent) ? 'Wayfinder: an agent needs you' : 'Wayfinder: agent updates', text };
}

export function signAgentApproval(input: { agentId: string; draftId: string; now: Date; secret: string; ttlMs?: number }): string {
  if (!input.secret) throw new Error('WAYFINDER_NOTIFY_LINK_SECRET is required to sign approval codes');
  const exp = input.now.getTime() + (input.ttlMs ?? APPROVAL_TTL_MS);
  const jti = randomUUID().replace(/-/g, '').slice(0, 16);
  const payload = `${input.agentId}.${input.draftId}.${exp}.${jti}`;
  const sig = createHmac('sha256', input.secret).update(`agent-approve:${payload}`).digest('base64url').slice(0, 32);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export type ApprovalCheck = { ok: true; agentId: string; draftId: string; jti: string } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };
export function verifyAgentApproval(code: string, secret: string, now: Date): ApprovalCheck {
  let raw: string;
  try { raw = Buffer.from(code, 'base64url').toString('utf8'); } catch { return { ok: false, reason: 'malformed' }; }
  const parts = raw.split('.');
  if (parts.length !== 5 || !secret) return { ok: false, reason: 'malformed' };
  const [agentId, draftId, expRaw, jti, sig] = parts;
  const expected = createHmac('sha256', secret).update(`agent-approve:${agentId}.${draftId}.${expRaw}.${jti}`).digest('base64url').slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || now.getTime() > exp) return { ok: false, reason: 'expired' };
  return { ok: true, agentId, draftId, jti };
}

const APPROVE_RE = /\bAPPROVE\s+([A-Za-z0-9_-]{40,400})/g;
/** Patient's own words: quoted history ("> ..." lines, "On ... wrote:") and APPROVE codes removed. */
export function replyInstructionText(body: string): string {
  const own: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*On .+wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    own.push(line);
  }
  return own.join('\n').replace(APPROVE_RE, '').replace(/\s+/g, ' ').trim();
}

export interface PatientReplyDeps {
  /** The patient's VERIFIED account email for this case (null when none: then nothing is acted on). */
  verifiedEmail(caseId: string): Promise<string | null>;
  /** Agents of the case named in the digest thread (id + name). */
  agents(caseId: string): Promise<{ id: string; name: string; contactId: string | null }[]>;
  /** Records the jti; false when it was already used (replay). */
  consume(jti: string, agentId: string, draftId: string): Promise<boolean>;
  /** The normal approve path (OutreachService.approve -> checkOutbound -> channel). */
  approve(contactId: string, draftId: string): Promise<{ ok: true } | { ok: false; reasons: string[] }>;
  /** Draft ids that belong to this agent's own contact (approval codes for other agents' drafts are refused). */
  draftContact(agentId: string, draftId: string): Promise<string | null>;
  chat(agentId: string, text: string): Promise<void>;
  secret: string;
  now?: () => Date;
}

export type PatientReplyResult =
  | { ignored: 'not_patient' | 'no_verified_email' | 'empty' }
  | { approvals: { draftId: string; result: string }[]; chattedWith: string | null };

export async function handlePatientReply(input: { caseId: string; from: string; body: string }, deps: PatientReplyDeps): Promise<PatientReplyResult> {
  const now = deps.now?.() ?? new Date();
  const verified = await deps.verifiedEmail(input.caseId);
  if (!verified) return { ignored: 'no_verified_email' };
  const from = normalizeAddress(/<([^>]+)>/.exec(input.from)?.[1] ?? input.from);
  if (from !== normalizeAddress(verified)) return { ignored: 'not_patient' };
  const agents = await deps.agents(input.caseId);
  const approvals: { draftId: string; result: string }[] = [];
  for (const m of input.body.matchAll(APPROVE_RE)) {
    const check = verifyAgentApproval(m[1], deps.secret, now);
    if (!check.ok) { approvals.push({ draftId: '?', result: check.reason }); continue; }
    if (!agents.some(a => a.id === check.agentId)) { approvals.push({ draftId: check.draftId, result: 'wrong_case' }); continue; }
    const contactId = await deps.draftContact(check.agentId, check.draftId);
    if (!contactId) { approvals.push({ draftId: check.draftId, result: 'not_this_agents_draft' }); continue; }
    if (!await deps.consume(check.jti, check.agentId, check.draftId)) { approvals.push({ draftId: check.draftId, result: 'replayed' }); continue; }
    const r = await deps.approve(contactId, check.draftId);
    approvals.push({ draftId: check.draftId, result: r.ok ? 'sent' : `refused: ${r.reasons.join(', ')}` });
  }
  const text = replyInstructionText(input.body);
  let chattedWith: string | null = null;
  if (text) {
    const lower = text.toLowerCase();
    const named = agents.find(a => lower.includes(a.name.replace(/ agent$/i, '').toLowerCase()));
    const target = named ?? (agents.length === 1 ? agents[0] : agents[0]);
    if (target) { await deps.chat(target.id, text); chattedWith = target.id; }
  }
  if (!text && approvals.length === 0) return { ignored: 'empty' };
  return { approvals, chattedWith };
}
