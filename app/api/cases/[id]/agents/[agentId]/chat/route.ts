import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardCase } from '@/lib/auth/ownership';
import { getAgentStore } from '@/lib/agents/factory/store';
import { handleChat, MAX_CHAT_CHARS } from '@/lib/agents/factory/chat';
import { defaultChatDeps, PostgresChatStore } from '@/lib/agents/factory/chat-deps';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string; agentId: string }> };
const bodySchema = z.object({ message: z.string().trim().min(1).max(MAX_CHAT_CHARS) }).strict();

async function load(req: Request, params: Ctx['params']) {
  const p = await params;
  const id = parseId(p.id);
  const agentId = parseId(p.agentId);
  if (!id || !agentId) return { error: jsonError(400, 'Invalid id') };
  const denied = await guardCase(req, id);
  if (denied) return { error: denied };
  if (!process.env.DATABASE_URL) return { error: jsonError(503, 'Agents need the database') };
  const agent = await getAgentStore().get(agentId);
  if (!agent || agent.caseId !== id) return { error: jsonError(404, 'Agent not found') };
  return { agentId };
}

/** GET -> { messages } (this agent's own thread, oldest first). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const r = await load(req, params);
    if ('error' in r) return r.error;
    return NextResponse.json({ messages: await new PostgresChatStore().list(r.agentId, 60) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) { return jsonError(500, 'Unable to load the chat', err); }
}

/** POST { message } -> { reply, card?, messages }. Any outbound action is an unapproved draft (card = Approve and send). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const r = await load(req, params);
    if ('error' in r) return r.error;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    const out = await handleChat(r.agentId, body.data.message, defaultChatDeps(), 'app');
    return NextResponse.json({ reply: out.reply, ...(out.card ? { card: out.card } : {}), messages: await new PostgresChatStore().list(r.agentId, 60) });
  } catch (err) { return jsonError(500, 'The agent could not answer', err); }
}
