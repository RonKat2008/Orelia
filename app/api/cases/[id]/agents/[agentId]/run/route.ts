import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { getAgentStore } from '@/lib/agents/factory/store';
import { runAgent } from '@/lib/agents/factory/runner';
import { defaultAgentDeps } from '@/lib/agents/factory/default-deps';
import { jsonError, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string; agentId: string }> };

/** POST /api/cases/[id]/agents/[agentId]/run -> runs one leased step now ("Run now", judge view). Never sends. */
export async function POST(req: Request, { params }: Ctx) {
  const p = await params;
  const id = parseId(p.id);
  const agentId = parseId(p.agentId);
  if (!id || !agentId) return jsonError(400, 'Invalid id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const agent = await getAgentStore().get(agentId);
    if (!agent || agent.caseId !== id) return jsonError(404, 'Agent not found');
    const out = await runAgent(agentId, defaultAgentDeps(), 'manual');
    if ('skipped' in out) return NextResponse.json({ skipped: out.skipped });
    return NextResponse.json({ steps: out.steps });
  } catch (err) {
    return jsonError(500, 'Agent run failed', err);
  }
}
