import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { agentCards } from '@/lib/agents/factory/view';
import { spawnForApprovedPlan } from '@/lib/agents/factory';
import { isExecutable } from '@/lib/plan/execute';
import { getPlanStore } from '@/lib/plan/store';
import { jsonError, parseId } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/agents[?events=N] -> { agents } (each with its own last N events, calls and applications). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  if (!process.env.DATABASE_URL) return jsonError(503, 'Agents need the database');
  try {
    const n = Number(new URL(req.url).searchParams.get('events') ?? '3');
    return NextResponse.json({ agents: await agentCards(id, Number.isFinite(n) ? n : 3) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return jsonError(500, 'Unable to load agents', err);
  }
}

/** POST /api/cases/[id]/agents -> spawns agents for the approved plan (idempotent) -> { created, agents }. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const plan = await getPlanStore().latest(id);
    if (!isExecutable(plan)) return jsonError(409, 'Approve the contact plan first');
    const out = await spawnForApprovedPlan(plan);
    if (!out) return jsonError(503, 'Agents need the database');
    return NextResponse.json(out);
  } catch (err) {
    return jsonError(500, 'Unable to start agents', err);
  }
}
