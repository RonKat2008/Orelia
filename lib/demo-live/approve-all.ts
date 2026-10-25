/**
 * "Approve all" for one case, used by the live demo console and scripts/demo-live.ts. It is the patient clicking
 * every approve button in order, through the NORMAL routes (plan approve -> outbox draft + approve per contact ->
 * application approve), so checkOutbound, consent, the allowlist, the 5-contact cap and cadence all run unchanged.
 * Client-safe: only fetch, no server imports. `fetchFn` carries the patient's session (browser cookie or script jar).
 */
import { isVapiDailyLimit, PHONE_LINE_DAILY_LIMIT_REASON, PHONE_LINE_UNAVAILABLE } from '../channels/vapi-limits';

export type FetchFn = (path: string, init?: RequestInit) => Promise<Response>;

export interface ApproveItem {
  kind: 'plan' | 'message' | 'application';
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** DEMO ONLY: the phone line could not place this call; offer "Take the call in your browser" for this contact. */
  browserCall?: { contactId: string; reason: string };
}

interface PlanBody { plan: { version: number; status: string; resources?: { contactId: string | null; steps: { channel: string; enabled: boolean }[] }[] } | null }
interface ContactsBody { contacts: { id: string; displayName: string; channel: string; state: string; consented: boolean; approved: boolean; followUpAwaitingApproval?: boolean }[] }
interface AppsBody { applications: { id: string; status: string; url?: string }[] }

const json = { 'content-type': 'application/json' };

async function errorBody(res: Response): Promise<{ text: string; detail?: string }> {
  try {
    const body = (await res.json()) as { error?: unknown; reasons?: unknown; detail?: unknown };
    const detail = typeof body.detail === 'string' ? body.detail : undefined;
    if (Array.isArray(body.reasons) && body.reasons.length) return { text: body.reasons.join(', '), ...(detail ? { detail } : {}) };
    if (typeof body.error === 'string') return { text: body.error };
  } catch { /* not JSON */ }
  return { text: `HTTP ${res.status}` };
}

async function errorText(res: Response): Promise<string> {
  return (await errorBody(res)).text;
}

/**
 * A call the phone line refused. Vapi's daily limit gets a friendly reason and the browser-call offer (demo
 * console); any other rejection keeps the plain reasons.
 */
async function callFailure(contactId: string, label: string, res: Response): Promise<ApproveItem> {
  const { text, detail } = await errorBody(res);
  if (isVapiDailyLimit(detail) || isVapiDailyLimit(text)) {
    return { kind: 'message', id: contactId, label, ok: false, detail: `${PHONE_LINE_UNAVAILABLE}. ${PHONE_LINE_DAILY_LIMIT_REASON}`, browserCall: { contactId, reason: PHONE_LINE_DAILY_LIMIT_REASON } };
  }
  return { kind: 'message', id: contactId, label, ok: false, detail: detail ? `${text}: ${detail}` : text };
}

/** Approves the plan (if needed). Approval writes drafts and fills applications; nothing is sent by this step. */
async function approvePlan(caseId: string, f: FetchFn): Promise<ApproveItem | null> {
  const res = await f(`/api/cases/${caseId}/plan?optional=1`);
  if (!res.ok) return { kind: 'plan', id: caseId, label: 'Contact plan', ok: false, detail: await errorText(res) };
  const { plan } = (await res.json()) as PlanBody;
  if (!plan) return null;
  if (plan.status === 'approved') return null;
  const patch = await f(`/api/cases/${caseId}/plan`, { method: 'PATCH', headers: json, body: JSON.stringify({ version: plan.version, edits: [{ type: 'approve' }] }) });
  return { kind: 'plan', id: caseId, label: 'Contact plan', ok: patch.ok, detail: patch.ok ? 'approved; drafts written' : await errorText(patch) };
}

/** One approval per contact that has something waiting: a first message, a reply letter, or a drafted follow-up. */
/** Contacts whose plan actually emails or calls them (a form-only resource's contact is never messaged). */
async function plannedMessageContacts(caseId: string, f: FetchFn): Promise<Map<string, Set<string>> | null> {
  const res = await f(`/api/cases/${caseId}/plan?optional=1`);
  if (!res.ok) return null;
  const { plan } = (await res.json()) as PlanBody;
  if (!plan?.resources) return null;
  const out = new Map<string, Set<string>>();
  for (const r of plan.resources) {
    if (!r.contactId) continue;
    out.set(r.contactId, new Set(r.steps.filter((s) => s.enabled && s.channel !== 'web_form').map((s) => s.channel)));
  }
  return out;
}

const wantsMessage = (planned: Map<string, Set<string>> | null, c: ContactsBody['contacts'][number]) =>
  c.followUpAwaitingApproval || !planned || (planned.get(c.id)?.has(c.channel) ?? false);

async function approveMessages(caseId: string, f: FetchFn): Promise<ApproveItem[]> {
  const res = await f(`/api/cases/${caseId}/contacts`);
  if (!res.ok) return [{ kind: 'message', id: caseId, label: 'Contacts', ok: false, detail: await errorText(res) }];
  const { contacts } = (await res.json()) as ContactsBody;
  const planned = await plannedMessageContacts(caseId, f);
  const waiting = contacts.filter((c) => c.consented && (c.state === 'drafted' || c.followUpAwaitingApproval) && wantsMessage(planned, c));
  const out: ApproveItem[] = [];
  for (const c of waiting) {
    const label = `${c.channel === 'voice' ? 'Call' : 'Email'}: ${c.displayName}`;
    const d = await f(`/api/contacts/${c.id}/drafts`, { method: 'POST', headers: json, body: '{}' });
    if (!d.ok) { out.push({ kind: 'message', id: c.id, label, ok: false, detail: await errorText(d) }); continue; }
    const draft = (await d.json()) as { id: string; approvedAt?: string | null; sentAt?: string | null };
    if (draft.approvedAt || draft.sentAt) continue;
    const a = await f(`/api/contacts/${c.id}/approve`, { method: 'POST', headers: json, body: JSON.stringify({ draftId: draft.id }) });
    if (!a.ok && c.channel === 'voice') { out.push(await callFailure(c.id, label, a)); continue; }
    out.push({ kind: 'message', id: c.id, label, ok: a.ok, detail: a.ok ? (c.channel === 'voice' ? 'call placed' : 'sent') : await errorText(a) });
  }
  return out;
}

interface QuestionsBody { questions: { fieldKey: string; suggestion: { value: string; origin: string } | null }[] }

/**
 * Demo only: answers the form's own questions (name, date of birth, email...) from the synthetic demo patient. Only
 * pre-fills the server labels 'demo' are used, so a real patient's profile is never submitted without them seeing it.
 */
async function fillDemoAnswers(caseId: string, appId: string, f: FetchFn): Promise<ApproveItem | null> {
  const base = `/api/cases/${caseId}/applications/${appId}/answers`;
  const q = await f(base);
  if (!q.ok) return null;
  const { questions } = (await q.json()) as QuestionsBody;
  const answers = Object.fromEntries(questions.flatMap((x) => (x.suggestion?.origin === 'demo' ? [[x.fieldKey, { value: x.suggestion.value, origin: 'demo' }]] : [])));
  if (!Object.keys(answers).length) return null;
  const s = await f(base, { method: 'POST', headers: json, body: JSON.stringify({ answers }) });
  return { kind: 'application', id: appId, label: 'Form questions', ok: s.ok, detail: s.ok ? `${Object.keys(answers).length} answered from the demo patient` : await errorText(s) };
}

async function approveApplications(caseId: string, f: FetchFn): Promise<ApproveItem[]> {
  const res = await f(`/api/cases/${caseId}/applications`);
  if (!res.ok) return [];
  const { applications } = (await res.json()) as AppsBody;
  const out: ApproveItem[] = [];
  for (const app of applications.filter((a) => a.status === 'draft')) {
    const filled = await fillDemoAnswers(caseId, app.id, f);
    if (filled) out.push(filled);
    if (filled && !filled.ok) continue;
    const a = await f(`/api/cases/${caseId}/applications/${app.id}/approve`, { method: 'POST', headers: json, body: '{}' });
    out.push({ kind: 'application', id: app.id, label: 'Online application', ok: a.ok, detail: a.ok ? 'approved; submitting' : await errorText(a) });
  }
  return out;
}

export async function approveAll(caseId: string, f: FetchFn): Promise<ApproveItem[]> {
  const plan = await approvePlan(caseId, f);
  const messages = await approveMessages(caseId, f);
  const apps = await approveApplications(caseId, f);
  return [...(plan ? [plan] : []), ...messages, ...apps];
}

/** What "Approve all" would approve right now (for the per-item review list). Read-only. */
export async function pendingApprovals(caseId: string, f: FetchFn): Promise<{ plan: boolean; messages: number; applications: number }> {
  const [p, c, a] = await Promise.all([f(`/api/cases/${caseId}/plan?optional=1`), f(`/api/cases/${caseId}/contacts`), f(`/api/cases/${caseId}/applications`)]);
  const plan = p.ok ? ((await p.json()) as PlanBody).plan : null;
  const contacts = c.ok ? ((await c.json()) as ContactsBody).contacts : [];
  const planned = new Map((plan?.resources ?? []).flatMap((r) => (r.contactId ? [[r.contactId, new Set(r.steps.filter((s) => s.enabled && s.channel !== 'web_form').map((s) => s.channel))] as const] : [])));
  const apps = a.ok ? ((await a.json()) as AppsBody).applications : [];
  return {
    plan: !!plan && plan.status !== 'approved',
    messages: contacts.filter((x) => x.consented && (x.state === 'drafted' || x.followUpAwaitingApproval) && wantsMessage(plan?.resources ? planned : null, x)).length,
    applications: apps.filter((x) => x.status === 'draft').length,
  };
}
