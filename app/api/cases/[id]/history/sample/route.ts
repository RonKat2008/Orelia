import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardCase } from '@/lib/auth/ownership';
import { demoEnabled } from '@/app/api/demo/lib/guard';
import { HISTORY_FIXTURE_SLUGS, loadHistoryFixture } from '@/fixtures/history';
import { getHistoryStore } from '@/lib/history/store';
import { addRecord, HistoryLimitError, loadTimeline } from '@/lib/history/ingest';
import { jsonError, parseBody, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ slug: z.enum(HISTORY_FIXTURE_SLUGS) }).strict();

/** POST /api/cases/[id]/history/sample { slug } -> 201 { timeline }. Demo/offline only; synthetic records. */
export async function POST(req: Request, { params }: Ctx) {
  if (!demoEnabled(process.env) && process.env.WAYFINDER_OFFLINE !== '1') return jsonError(404, 'Not found');
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const existing = new Set((await getHistoryStore().listDocuments(id)).map(d => d.title));
    for (const record of await loadHistoryFixture(body.data.slug)) {
      if (existing.has(record.title)) continue;
      await addRecord(id, { title: record.title, text: record.text, docType: record.docType });
    }
    return NextResponse.json({ timeline: await loadTimeline(id) }, { status: 201 });
  } catch (err) {
    if (err instanceof HistoryLimitError) return jsonError(422, err.message);
    return jsonError(500, 'Unable to load the sample records', err);
  }
}
