/**
 * "Approve all" for one case, used by the live demo console and scripts/demo-live.ts. It is the patient clicking
 * every approve button in order, through the NORMAL routes (plan approve -> outbox draft + approve per contact ->
 * application approve), so checkOutbound, consent, the allowlist, the 5-contact cap and cadence all run unchanged.
 * Client-safe: only fetch, no server imports. `fetchFn` carries the patient's session (browser cookie or script jar).
 */
export type FetchFn = (path: string, init?: RequestInit) => Promise<Response>;

export interface ApproveItem {
  kind: 'plan' | 'message' | 'application';
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface PlanBody { plan: { version: number; status: string } | null }
interface ContactsBody { contacts: { id: string; displayName: string; channel: string; state: string; consented: boolean; approved: boolean; followUpAwaitingApproval?: boolean }[] }
interface AppsBody { applications: { id: string; status: string; url?: string }[] }

const json = { 'content-type': 'application/json' };

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; reasons?: unknown };
    if (Array.isArray(body.reasons) && body.reasons.length) return body.reasons.join(', ');
    if (typeof body.error === 'string') return body.error;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
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
async function approveMessages(caseId: string, f: FetchFn): Promise<ApproveItem[]> {
  const res = await f(`/api/cases/${caseId}/contacts`);
  if (!res.ok) return [{ kind: 'message', id: caseId, label: 'Contacts', ok: false, detail: await errorText(res) }];
  const { contacts } = (await res.json()) as ContactsBody;
  const waiting = contacts.filter((c) => c.consented && (c.state === 'drafted' || c.followUpAwaitingApproval));
  const out: ApproveItem[] = [];
  for (const c of waiting) {
    const label = `${c.channel === 'voice' ? 'Call' : 'Email'}: ${c.displayName}`;
    const d = await f(`/api/contacts/${c.id}/drafts`, { method: 'POST', headers: json, body: '{}' });
    if (!d.ok) { out.push({ kind: 'message', id: c.id, label, ok: false, detail: await errorText(d) }); continue; }
    const draft = (await d.json()) as { id: string; approvedAt?: string | null; sentAt?: string | null };
    if (draft.approvedAt || draft.sentAt) continue;
    const a = await f(`/api/contacts/${c.id}/approve`, { method: 'POST', headers: json, body: JSON.stringify({ draftId: draft.id }) });
    out.push({ kind: 'message', id: c.id, label, ok: a.ok, detail: a.ok ? (c.channel === 'voice' ? 'call placed' : 'sent') : await errorText(a) });
  }
  return out;
}

async function approveApplications(caseId: string, f: FetchFn): Promise<ApproveItem[]> {
  const res = await f(`/api/cases/${caseId}/applications`);
  if (!res.ok) return [];
  const { applications } = (await res.json()) as AppsBody;
  const out: ApproveItem[] = [];
  for (const app of applications.filter((a) => a.status === 'draft')) {
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
  const apps = a.ok ? ((await a.json()) as AppsBody).applications : [];
  return {
    plan: !!plan && plan.status !== 'approved',
    messages: contacts.filter((x) => x.consented && (x.state === 'drafted' || x.followUpAwaitingApproval)).length,
    applications: apps.filter((x) => x.status === 'draft').length,
  };
}
