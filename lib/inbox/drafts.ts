import { AI_DISCLOSURE_EMAIL, flagMedicalAdvice, minimize, withDisclosure, type CaseRecord } from '../safety';
import type { TaskKind } from '../contracts/task';
import type { InboxClassification } from './schema';

export interface Party { name: string; email?: string; address?: string }
export interface DraftContext {
  contextDocIds?: string[];
  coordinatorQuestion?: string;
  contactId: string;
  /** Stored inbound message this event came from; carried into every task's details. */
  messageId?: string;
  caseId: string;
  resourceName: string;
  resourceAddress?: string;
  currentPhysician?: Party;
  pathologyLab?: Party;
  consent: { sharedFields: string[] };
  caseRecord: CaseRecord;
  nextRankedOption?: { name: string; id: string };
}
export interface TaskLetter { to?: string; toName?: string; subject: string; body: string }
export interface TaskDraft {
  contextDocIds?: string[];
  contactId: string;
  caseId: string;
  kind: TaskKind;
  title: string;
  status: 'open';
  requiresApproval: true;
  approvedAt: null;
  /** Letter text or checklist, stored in tasks.draft_body. */
  draftBody?: string;
  letter?: TaskLetter;
  details?: Record<string, unknown>;
}

export class MedicalAdviceInDraft extends Error {
  constructor(readonly matches: string[]) {
    super(`Generated draft flagged for medical advice: ${matches.join('; ')}`);
    this.name = 'MedicalAdviceInDraft';
  }
}

const humanize = (key: string) => key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

function sharedLines(ctx: DraftContext): string {
  const shared = minimize(ctx.caseRecord, ctx.consent.sharedFields);
  const lines = Object.entries(shared).map(([k, v]) => `- ${humanize(k)}: ${show(v)}`);
  return lines.length ? `Information the patient chose to share:\n${lines.join('\n')}` : '';
}

function letter(ctx: DraftContext, to: Party | undefined, subject: string, lead: string, extra: string[] = []): TaskLetter {
  const body = [`Hello${to?.name ? ` ${to.name}` : ''},`, lead, ...extra, sharedLines(ctx), 'Thank you for your help.'].filter(Boolean).join('\n\n');
  return { to: to?.email, toName: to?.name, subject, body: withDisclosure(body) };
}

/** Drafts only; every task needs the patient's approval and nothing is sent from here. */
export function draftTasks(c: InboxClassification, ctx: DraftContext): TaskDraft[] {
  const base = { contextDocIds: ctx.contextDocIds ?? [], contactId: ctx.contactId, caseId: ctx.caseId, status: 'open', requiresApproval: true, approvedAt: null } as const;
  const res = ctx.resourceName;
  const where = ctx.resourceAddress ? ` (${ctx.resourceAddress})` : '';
  let draft: TaskDraft;
  switch (c.class) {
    case 'needs_referral': {
      const l = letter(ctx, ctx.currentPhysician, `Referral request: ${res}`, `${res} has told me they need a referral before scheduling. Could you please send a referral to ${res}${where}?`);
      draft = { ...base, kind: 'referral', title: `Request a referral to ${res}`, letter: l, draftBody: l.body };
      break;
    }
    case 'send_slides': {
      const lab = ctx.pathologyLab;
      const l = letter(ctx, lab, `Pathology slide request for ${res}`, `${res} has asked for the original pathology slides. Please release them to ${res}${where}.`, c.lab?.accession ? [`Accession number: ${c.lab.accession}`] : []);
      draft = { ...base, kind: 'slides', title: `Request slides for ${res}`, letter: l, draftBody: l.body, details: { accession: c.lab?.accession, lab: c.lab?.name ?? lab?.name } };
      break;
    }
    case 'send_records': {
      const checklist = ['Visit and clinic notes', 'Imaging reports and discs', 'Pathology reports', 'Lab results', ...(c.haveReady ?? [])];
      const l = letter(ctx, ctx.currentPhysician, `Records release request for ${res}`, `${res} has asked for my records. Please send copies of the items below to ${res}${where}.`, [checklist.map(i => `- ${i}`).join('\n')]);
      draft = { ...base, kind: 'records', title: `Send records to ${res}`, letter: l, draftBody: `Records packet checklist for ${res}:\n${checklist.map(i => `[ ] ${i}`).join('\n')}\n\n${l.body}`, details: { checklist } };
      break;
    }
    case 'call_to_schedule': {
      const details = { phone: c.phone, hours: c.hours, haveReady: c.haveReady ?? [] };
      const note = [`Call ${res}${c.phone ? ` at ${c.phone}` : ' (no number was stated in their reply)'}`, c.hours ? `Hours: ${c.hours}` : '', details.haveReady.length ? `Have ready: ${details.haveReady.join(', ')}` : ''].filter(Boolean).join('\n');
      draft = { ...base, kind: 'call', title: `Call ${res} to schedule`, draftBody: note, details };
      break;
    }
    case 'redirect': {
      const r = c.redirect ?? {};
      const target: Party = { name: r.name ?? r.department ?? 'there', email: r.email };
      const l = letter(ctx, target, `Introduction on behalf of a patient (via ${res})`, `${res} suggested I contact ${r.department ?? 'your team'} about getting seen. Could you tell me the next step?`);
      draft = { ...base, kind: 'redirect', title: `Contact ${r.name ?? r.department ?? 'the suggested contact'} instead`, letter: l, draftBody: l.body, details: { redirect: r, quote: c.quote } };
      break;
    }
    case 'declined': {
      const next = ctx.nextRankedOption;
      const suggestion = next ? `Suggested next option: ${next.name}` : c.redirect ? 'Consider the contact they suggested.' : 'No next option is ranked yet.';
      draft = { ...base, kind: 'declined', title: `${res} declined`, draftBody: `Close this contact. ${suggestion}`, details: { closeContact: true, nextRankedOptionId: next?.id } };
      break;
    }
    default:
      draft = { ...base, kind: 'unclear', title: `Review the reply from ${res}`, draftBody: `We could not tell what ${res} is asking. Please read the reply and decide what to do.`, details: { quote: c.quote, rationale: c.rationale } };
  }
  // Answer administrative questions only from the current consented record, never retrieved text.
  if (/insurance|insurer|plan\b/i.test(ctx.coordinatorQuestion ?? '')) {
    const shared = minimize(ctx.caseRecord, ctx.consent.sharedFields);
    const answer = ['insurer', 'planId'].filter(key => shared[key] != null)
      .map(key => `${humanize(key)}: ${show(shared[key])}`).join('\n') || "I'll have the patient follow up";
    draft.draftBody = `${draft.draftBody ?? ''}\n\nCoordinator Q&A:\n${answer}`;
  }
  draft.details = { ...draft.details, contextDocIds: draft.contextDocIds, ...(ctx.messageId ? { messageId: ctx.messageId } : {}) };
  // The sender's verbatim quote is not our text, so only generated text is screened.
  const hits = flagMedicalAdvice([draft.title, draft.draftBody ?? '', draft.letter?.subject ?? '', draft.letter?.body ?? '', c.rationale].join('\n'));
  if (hits.flagged) throw new MedicalAdviceInDraft(hits.matches);
  if (draft.letter && !draft.letter.body.includes(AI_DISCLOSURE_EMAIL)) throw new Error('Letter missing AI disclosure');
  return [draft];
}
