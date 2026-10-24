import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { gatewayConfig } from '@/lib/ai/gateway';
import { addRecordBodySchema, MAX_RECORD_CHARS } from '@/lib/history/contract';
import { addRecord, HistoryLimitError, loadTimeline } from '@/lib/history/ingest';
import { fieldPaths, jsonError, parseId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/history -> { timeline } */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    return NextResponse.json({ timeline: await loadTimeline(id) });
  } catch (err) {
    return jsonError(500, 'Unable to load the medical history', err);
  }
}

/** POST /api/cases/[id]/history { title, text, docType? } -> 201 { document, events, timeline } */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonError(400, 'Body must be valid JSON'); }
  const text = typeof raw === 'object' && raw !== null ? (raw as { text?: unknown }).text : undefined;
  if (typeof text === 'string' && text.length > MAX_RECORD_CHARS) return jsonError(413, `A record can be at most ${MAX_RECORD_CHARS} characters`);
  const body = addRecordBodySchema.safeParse(raw);
  if (!body.success) return jsonError(400, 'Invalid body', undefined, fieldPaths(body.error));
  try {
    const result = await addRecord(id, body.data, { llm: gatewayConfig() !== undefined });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof HistoryLimitError) return jsonError(422, err.message);
    return jsonError(500, 'Unable to add the record', err);
  }
}
