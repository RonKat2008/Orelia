import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inferDocType } from '@/lib/history/doc-type';
import type { DocType } from '@/lib/history/contract';

export const HISTORY_FIXTURE_SLUGS = ['epithelioid-sarcoma', 'vascular-eds', 'igg4-related-disease'] as const;
export type HistoryFixtureSlug = (typeof HISTORY_FIXTURE_SLUGS)[number];

export interface HistoryFixtureRecord { title: string; text: string; docType: DocType }

export function isHistoryFixtureSlug(value: string): value is HistoryFixtureSlug {
  return (HISTORY_FIXTURE_SLUGS as readonly string[]).includes(value);
}

/** Synthetic multi-year record set for one fixture case (deliberate conflicts included). Files load in name order. */
export async function loadHistoryFixture(slug: HistoryFixtureSlug): Promise<HistoryFixtureRecord[]> {
  if (!isHistoryFixtureSlug(slug)) throw new Error(`Unknown history fixture: ${String(slug)}`);
  const dir = path.join(process.cwd(), 'fixtures', 'history', slug);
  const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort();
  return Promise.all(files.map(async file => {
    const text = (await readFile(path.join(dir, file), 'utf8')).trim();
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? file.replace(/\.md$/, '');
    return { title, text, docType: inferDocType(title, text) };
  }));
}
