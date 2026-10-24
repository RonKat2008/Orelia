import { NextResponse } from 'next/server';
import { rejectCrossOrigin } from '@/lib/auth/origin';
import { reviewDecisionBodySchema } from '@/lib/coordination/contract';
import { ConsultError, getConsultService } from '@/lib/coordination/consult';
import { checkRateLimit, clientIp as platformIp, getRateLimitStore, rateLimitedResponse, type RateRule } from '@/lib/rate-limit';
import { jsonError, parseBody } from '../../cases/_lib/http';

export const runtime = 'nodejs';

/**
 * Public doctor review API. No session or case ownership: the signed review token IS the capability. Only the
 * request itself is ever returned. Unknown, forged, expired, cancelled and already-decided links all get the same
 * generic 404 on GET.
 */
type Ctx = { params: Promise<{ token: string }> };

const MINUTE = 60_000;
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Security review #6: the platform-provided IP only (never X-Forwarded-For). */
function clientIp(req: Request): string {
  return platformIp(req) ?? 'unknown';
}

function rules(req: Request, method: 'get' | 'post'): RateRule[] {
  return [
    { key: `review:${method}:ip:${clientIp(req)}`, max: method === 'get' ? 30 : 10, windowMs: 10 * MINUTE },
  ];
}

async function limited(rs: RateRule[]): Promise<Response | null> {
  const r = await checkRateLimit(getRateLimitStore(), rs);
  return r.ok ? null : rateLimitedResponse(r.retryAfterSeconds);
}

/** Decision POSTs per signature-valid token (any IP): 5 per 10 minutes. */
const POSTS_PER_TOKEN = 5;

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  try {
    const slow = await limited(rules(req, 'get'));
    if (slow) return slow;
    const review = await getConsultService().reviewView(token);
    return review ? NextResponse.json({ review }, { headers: { 'Cache-Control': 'no-store' } }) : notFound();
  } catch (err) {
    return jsonError(500, 'Unable to open this request', err);
  }
}

/** POST { decision: 'approve', subject, body, note? } | { decision: 'decline', note? } -> { review }. Once only (409 after). */
export async function POST(req: Request, { params }: Ctx) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { token } = await params;
  try {
    const slow = await limited(rules(req, 'post'));
    if (slow) return slow;
    const service = getConsultService();
    const tokenHash = service.signedTokenHash(token);
    if (!tokenHash) return notFound();
    const perToken = await limited([{ key: `review:post:token:${tokenHash}`, max: POSTS_PER_TOKEN, windowMs: 10 * MINUTE }]);
    if (perToken) return perToken;
    const body = await parseBody(req, reviewDecisionBodySchema);
    if (!body.ok) return body.response;
    const audit = { ip: clientIp(req), userAgent: (req.headers.get('user-agent') ?? '').slice(0, 512) };
    const { review, footerAdded } = await service.reviewDecide(token, body.data, audit);
    return NextResponse.json({ review, ...(footerAdded ? { notice: 'The approval line and AI disclosure are always included, so they were added back.' } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ConsultError) {
      if (err.status === 404) return notFound();
      return NextResponse.json(err.reasons?.length ? { error: err.message, reasons: err.reasons } : { error: err.message }, { status: err.status });
    }
    return jsonError(500, 'Unable to save your decision', err);
  }
}
