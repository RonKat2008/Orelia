import { activeContactCount, MAX_ACTIVE_CONTACTS } from '../safety/caps';
import { normalizeAddress } from '../safety/allowlist';
import { OutreachError, type Contact, type Draft, type OutreachStore } from '../outreach/types';
import { inboundReplyContactPoint } from './contact-point';
import type { InboundMessageStore } from './inbound-store';
import type { StoredTask, TaskStore } from './task-store';

export interface ApproveInput { confirmAddress?: string }
export interface ApproveDeps { tasks: TaskStore; outreach: OutreachStore; inbound: InboundMessageStore; clock?: () => Date; newId?: () => string }

/**
 * Approving a task prepares the next step; it never sends. Draft-bearing tasks produce an unapproved outreach
 * Draft for the recipient contact. The patient must still give per-contact consent and POST /api/contacts/[id]/approve,
 * which runs checkOutbound (allowlist, disclosure, minimization, cap, consent). No Channel is touched here.
 */
export async function approveTask(taskId: string, deps: ApproveDeps, input: ApproveInput = {}) {
  const { tasks } = deps;
  const now = (deps.clock?.() ?? new Date()).toISOString();
  const task = await tasks.task(taskId);
  if (!task) throw new OutreachError(404, ['task_not_found']);
  if (task.status !== 'open') throw new OutreachError(409, ['already_approved']);
  // Application tasks are approved on the application draft itself (web_application store), never through this generic path.
  if (task.kind === 'application') throw new OutreachError(422, ['use_application_approval']);
  if (['referral', 'slides', 'records', 'redirect'].includes(task.kind)) return approveLetter(task, now, deps, input);
  if (!await tasks.markApproved(taskId, now)) throw new OutreachError(409, ['already_approved']);
  const done = { ...task, status: 'done' as const, approvedAt: now };
  if (task.kind === 'declined') {
    await tasks.closeContact(task.contactId);
    await tasks.markDone(taskId);
    return { task: done, nextCandidate: await tasks.nextCandidate(task.caseId) ?? null };
  }
  await tasks.markDone(taskId);
  if (task.kind === 'call') {
    const d = (task.details ?? {}) as { phone?: string; hours?: string; haveReady?: string[] };
    return { task: done, call: { phone: d.phone, hours: d.hours, haveReady: d.haveReady ?? [] } };
  }
  return { task: done };
}

async function approveLetter(task: StoredTask, now: string, deps: ApproveDeps, input: ApproveInput) {
  const { tasks, outreach } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const to = task.letter?.to ? normalizeAddress(task.letter.to) : null;
  if (!task.letter || !to || !to.includes('@')) throw new OutreachError(422, ['recipient_missing']);
  let evidence: ReturnType<typeof inboundReplyContactPoint> | undefined;
  if (task.kind === 'redirect') {
    const r = (task.details?.redirect ?? {}) as { email?: string };
    const replyEmail = r.email ? normalizeAddress(r.email) : null;
    if (!replyEmail || replyEmail !== to) throw new OutreachError(422, ['recipient_missing']);
    // HARD RULE 2: a model never invents a contact. The address must be literally in a stored reply on this
    // contact's thread, and the patient must retype/confirm it.
    const messageId = typeof task.details?.messageId === 'string' ? task.details.messageId : undefined;
    if (!messageId) throw new OutreachError(422, ['redirect_unverified']);
    const message = await deps.inbound.get(messageId);
    if (!message || message.contactId !== task.contactId) throw new OutreachError(422, ['redirect_unverified']);
    if (!addressInText(replyEmail, message.body)) throw new OutreachError(422, ['redirect_address_not_in_reply']);
    if (input.confirmAddress == null || !input.confirmAddress.trim()) throw new OutreachError(422, ['address_confirmation_required']);
    if (normalizeAddress(input.confirmAddress) !== replyEmail) throw new OutreachError(422, ['address_confirmation_mismatch']);
    evidence = inboundReplyContactPoint({ channel: 'email', address: replyEmail, messageId, receivedAt: now });
  }
  const original = await outreach.contact(task.contactId);
  if (!original) throw new OutreachError(404, ['contact_not_found']);
  const existing = await outreach.contacts(task.caseId);
  let recipient: Contact | undefined = existing.find(c => normalizeAddress(c.address) === to);
  // Pre-check the cap so a refusal never leaves the task approved.
  if (!recipient && activeContactCount(existing) + 1 > MAX_ACTIVE_CONTACTS) throw new OutreachError(422, ['contact_cap']);
  if (!await tasks.markApproved(task.id, now)) throw new OutreachError(409, ['already_approved']);
  try {
    if (!recipient) {
      const proposed: Contact = { id: newId(), caseId: task.caseId, targetId: original.targetId, targetKind: original.targetKind, purpose: original.purpose, channel: 'email', address: to, state: 'drafted' };
      const created = await outreach.select(task.caseId, [proposed], MAX_ACTIVE_CONTACTS);
      recipient = created.find(c => normalizeAddress(c.address) === to);
      if (!recipient) throw new OutreachError(409, ['recipient_not_created']);
    }
    const consent = await outreach.consent(original.id);
    const draft: Draft = {
      id: newId(), contactId: recipient.id, caseId: task.caseId, channel: 'email', address: recipient.address,
      subject: task.letter.subject, body: task.letter.body, sharedFields: [...(consent?.sharedFields ?? [])], approvedAt: null, sentAt: null,
    };
    await outreach.saveDraft(draft);
    const hasConsent = !!(await outreach.consent(recipient.id));
    await tasks.markDone(task.id, evidence ? { evidence } : undefined);
    return { task: { ...task, status: 'done' as const, approvedAt: now }, contact: recipient, draft, evidence, next: hasConsent ? ['approve'] : ['consent', 'approve'] };
  } catch (error) {
    await tasks.reopen(task.id);
    throw error;
  }
}

const EMAIL_TOKEN = /[^\s<>()[\]{},;:"'|\\]+@[^\s<>()[\]{},;:"'|\\]+/g;
/** True only if `address` appears as a whole email token in `body` (case-insensitive). Substrings of longer tokens do not match. */
export function addressInText(address: string, body: string): boolean {
  const want = normalizeAddress(address);
  if (!want) return false;
  const text = body.replace(/\s+/g, ' ');
  for (const m of text.matchAll(EMAIL_TOKEN)) {
    if (normalizeAddress(m[0].replace(/\.+$/, '')) === want) return true;
  }
  return false;
}
