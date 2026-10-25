import { NextResponse } from 'next/server';
import { rejectCrossOrigin } from '@/lib/auth/origin';
import { guardCase } from '@/lib/auth/ownership';
import { getAnswerQuestions, saveAnswers, type AnswersResult } from '@/lib/web-application/answer-service';
import { defaultAnswerDeps } from '@/lib/web-application/answer-server';
import { answersBodySchema } from '@/lib/web-application/answers';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string; applicationId?: string }> };

async function ids(req: Request, params: Ctx['params']): Promise<{ id: string; applicationId: string } | Response> {
  const p = await params;
  const id = parseId(p.id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const applicationId = parseId(p.applicationId ?? '');
  if (!applicationId) return jsonError(400, 'Invalid application id');
  return { id, applicationId };
}

function respond(res: AnswersResult): Response {
  if (!res.ok) return NextResponse.json({ error: res.error, ...(res.issues ? { issues: res.issues } : {}) }, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ application: res.application, questions: res.questions }, { headers: { 'Cache-Control': 'no-store' } });
}

/** GET -> the form's open questions (name, date of birth, email...) with pre-fills labelled by where they came from. */
export async function GET(req: Request, { params }: Ctx) {
  const got = await ids(req, params);
  if (got instanceof Response) return got;
  try {
    return respond(await getAnswerQuestions(got.id, got.applicationId, defaultAnswerDeps(req)));
  } catch (err) {
    return jsonError(500, 'Unable to load the form questions', err);
  }
}

/**
 * POST { answers: { fieldKey: value | {value, origin} } } -> "Save and fill". Stores the answers on this application
 * only and re-maps the captured form; it does not approve or submit anything.
 */
export async function POST(req: Request, { params }: Ctx) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const got = await ids(req, params);
  if (got instanceof Response) return got;
  const parsed = await parseBody(req, answersBodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return respond(await saveAnswers(got.id, got.applicationId, parsed.data, defaultAnswerDeps(req)));
  } catch (err) {
    return jsonError(500, 'Unable to save your answers', err);
  }
}
