import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { readSession } from '@/lib/auth/session';
import { getExpertTraceStore } from '@/lib/experts/store';
import { refreshResearch } from '@/lib/experts/refresh';
import { getRefreshPorts, loadTraceInput } from '@/lib/experts/wiring';
import { checkRateLimit, getRateLimitStore, rateLimitedResponse, REFRESH_RESEARCH_LIMITS } from '@/lib/rate-limit';
import { getServices } from '@/app/api/cases/_lib/services';
import { jsonError, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/cases/[id]/experts/refresh -> 201 { trace, added: { affiliations, contactPoints } }
 * Owner-only and rate-limited. Re-runs only the identity / contact-point stamping and the expert trace for an
 * existing case (public read-only lookups); it contacts nobody and never re-runs the research swarm.
 */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const limit = await checkRateLimit(getRateLimitStore(), REFRESH_RESEARCH_LIMITS(id, readSession(req) ?? 'anonymous'), new Date());
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);
    const { cases, persist } = getServices();
    const found = await cases.get(id);
    if (!found) return jsonError(404, 'Case not found');
    const store = getExpertTraceStore();
    const result = await refreshResearch(id, found.diseaseName, {
      persist,
      ports: getRefreshPorts(),
      loadTraceInput,
      saveTrace: (t) => store.save(t),
    });
    if (!result) return jsonError(404, 'Case not found');
    return NextResponse.json({ trace: result.trace, added: result.added }, { status: 201 });
  } catch (err) {
    return jsonError(500, 'Unable to refresh research', err);
  }
}
