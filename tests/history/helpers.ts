import { extractEventsWithRules, inferDocType } from '@/lib/history/extract';
import { sanitizeRecordText } from '@/lib/history/sanitize';
import { loadHistoryFixture, type HistoryFixtureSlug } from '@/fixtures/history';
import type { HistoryDocument, HistoryEvent } from '@/lib/history/contract';

export function makeDoc(id: string, title: string, text: string, over: Partial<HistoryDocument> = {}): HistoryDocument {
  return { id, caseId: 'case-1', title, docType: inferDocType(title, text), text, createdAt: '2026-10-24T00:00:00.000Z', extractedBy: 'rules', ...over };
}

export async function fixtureDocs(slug: HistoryFixtureSlug): Promise<HistoryDocument[]> {
  const records = await loadHistoryFixture(slug);
  return records.map((r, i) => makeDoc(`${slug}-${i + 1}`, r.title, sanitizeRecordText(r.text), { docType: r.docType }));
}

export async function fixtureEvents(slug: HistoryFixtureSlug): Promise<{ docs: HistoryDocument[]; events: HistoryEvent[] }> {
  const docs = await fixtureDocs(slug);
  return { docs, events: docs.flatMap(extractEventsWithRules) };
}
