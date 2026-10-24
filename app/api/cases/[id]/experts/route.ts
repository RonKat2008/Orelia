import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { traceExperts } from '@/lib/experts/trace';
import { getExpertTraceStore } from '@/lib/experts/store';
import { getTracePorts, loadTraceInput } from '@/lib/experts/wiring';
import { jsonError, parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/experts -> { trace } (null when none has been run). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ trace: await getExpertTraceStore().latest(id) });
  } catch (err) {
    return jsonError(500, 'Unable to load the research-to-care trace', err);
  }
}

/** POST /api/cases/[id]/experts -> run the tracer (read-only lookups, contacts nobody) and save it. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const input = await loadTraceInput(id);
    if (!input) return jsonError(404, 'Case not found');
    const trace = await traceExperts(input, getTracePorts());
    const saved = await getExpertTraceStore().save(trace);
    if (!saved) return jsonError(500, 'The trace could not be saved');
    return NextResponse.json({ trace: saved }, { status: 201 });
  } catch (err) {
    return jsonError(500, 'Unable to trace experts', err);
  }
}
