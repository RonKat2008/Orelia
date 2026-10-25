/**
 * Service behind GET/POST /api/cases/[id]/applications/[applicationId]/answers. The route has already checked the
 * caller owns the case; this layer also refuses an application that belongs to another case (cross-case write).
 */
import {
  answerableQuestions, answerKind, applyAnswers, suggestAnswers, validateAnswers,
  type AnswerQuestion, type AnswersBody, type AnswerSuggestion, type IdentityProfile,
} from './answers';
import type { ApplicationStore } from './store';
import type { PatientAnswer, WebApplicationDraft } from './types';

export interface AnswerServiceDeps {
  applications: ApplicationStore;
  /** The patient's generic identity details (account profile), or the synthetic demo patient on a demo case. */
  identity(caseId: string): Promise<{ profile: IdentityProfile; origin: 'profile' | 'demo' } | null>;
  now?: () => Date;
}

export interface QuestionView extends AnswerQuestion {
  suggestion: AnswerSuggestion | null;
}

export type AnswersResult =
  | { ok: true; application: WebApplicationDraft; questions: QuestionView[] }
  | { ok: false; status: number; error: string; issues?: { fieldKey: string; message: string }[] };

async function load(caseId: string, applicationId: string, deps: AnswerServiceDeps): Promise<WebApplicationDraft | null> {
  const app = await deps.applications.get(applicationId);
  return app && app.caseId === caseId ? app : null;
}

/**
 * The questions still open on the draft, plus the ones already answered (so they can be edited), each with a
 * pre-fill: stored answer, then profile/demo patient, then an earlier form on the same case.
 */
async function questionsFor(app: WebApplicationDraft, deps: AnswerServiceDeps): Promise<QuestionView[]> {
  // Answered fields are no longer in `missing`; rebuild the full question list from both.
  const answeredAsMissing = app.fields
    .filter(f => f.source.kind === 'patient')
    .map(f => ({ fieldKey: f.fieldKey, label: f.label, required: true, reason: 'no_consented_source' as const, question: '', type: f.type }));
  const questions = answerableQuestions({ missing: [...answeredAsMissing, ...app.missing] });
  if (!questions.length) return [];
  const [identity, siblings] = await Promise.all([deps.identity(app.caseId), deps.applications.listByCase(app.caseId)]);
  const earlier = siblings
    .filter(s => s.id !== app.id && s.caseId === app.caseId)
    .flatMap(s => Object.entries(s.answers ?? {}).map(([key, a]) => {
      const label = s.fields.find(f => f.fieldKey === key)?.label ?? key;
      const type = s.fields.find(f => f.fieldKey === key)?.type;
      return { label, kind: answerKind(label, type), value: a.value };
    }));
  const suggestions = suggestAnswers(questions, {
    stored: app.answers, profile: identity?.profile ?? null, profileOrigin: identity?.origin ?? 'profile', earlier,
  });
  return questions.map(q => ({ ...q, suggestion: suggestions[q.fieldKey] ?? null }));
}

export async function getAnswerQuestions(caseId: string, applicationId: string, deps: AnswerServiceDeps): Promise<AnswersResult> {
  const app = await load(caseId, applicationId, deps);
  if (!app) return { ok: false, status: 404, error: 'application_not_found' };
  return { ok: true, application: app, questions: await questionsFor(app, deps) };
}

/**
 * "Save and fill": validates, stores the answers on this application only, and re-maps the captured form fields so
 * answered questions leave `missing`. Approval (and the gate) is unchanged and still a separate step.
 */
export async function saveAnswers(caseId: string, applicationId: string, body: AnswersBody, deps: AnswerServiceDeps): Promise<AnswersResult> {
  const app = await load(caseId, applicationId, deps);
  if (!app) return { ok: false, status: 404, error: 'application_not_found' };
  if (app.status !== 'draft') return { ok: false, status: 409, error: 'already_approved' };
  // Re-answering: put previously answered fields back as questions, then apply the new set from scratch.
  const base = {
    fields: app.fields.filter(f => f.source.kind !== 'patient'),
    missing: [
      ...app.fields.filter(f => f.source.kind === 'patient').map(f => ({
        fieldKey: f.fieldKey, label: f.label, required: app.missing.find(m => m.fieldKey === f.fieldKey)?.required ?? true,
        reason: 'no_consented_source' as const, question: `What should we enter for "${f.label}"?`, type: f.type,
      })),
      ...app.missing,
    ],
  };
  // Keep previous answers the patient did not resend, so a partial save does not wipe them.
  const checked = validateAnswers(base, body, deps.now?.() ?? new Date());
  if (!checked.ok) return { ok: false, status: 422, error: 'invalid_answers', issues: checked.issues };
  const merged: Record<string, PatientAnswer> = { ...(app.answers ?? {}) };
  for (const key of Object.keys(body.answers)) delete merged[key];
  Object.assign(merged, checked.answers);
  // Restore the original field order of the form for missing entries that came from patient fields.
  const remapped = applyAnswers(base, merged);
  const saved = await deps.applications.saveAnswers(app.id, { caseId, answers: merged, fields: remapped.fields, missing: remapped.missing });
  if (!saved) return { ok: false, status: 409, error: 'already_approved' };
  return { ok: true, application: saved, questions: await questionsFor(saved, deps) };
}
