import { NextResponse } from 'next/server';
import { summarizeUsage, caseBudget } from '@/lib/ai/usage';
import { jsonError, parseId } from '../../_lib/http';
import { getServices } from '../../_lib/services';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  try {
    const services = getServices();
    if (!await services.cases.get(id)) return jsonError(404, 'Case not found');
    const usage = summarizeUsage(await services.runs.listByCase(id));
    const budgetUsd = caseBudget();
    return NextResponse.json({ ...usage, budgetUsd, budgetExceeded: usage.totals.knownCostUsd >= budgetUsd }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError(500, 'Unable to load usage');
  }
}
