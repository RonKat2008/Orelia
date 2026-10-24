import { describe, expect, it } from 'vitest';
import { HISTORY_FIXTURE_SLUGS, loadHistoryFixture } from '@/fixtures/history';
import { sanitizeRecordText } from '@/lib/history/sanitize';
import { MAX_RECORD_CHARS } from '@/lib/history/contract';

describe.each(HISTORY_FIXTURE_SLUGS)('history fixture %s', slug => {
  it('is a synthetic multi-record set that survives sanitizing unchanged', async () => {
    const records = await loadHistoryFixture(slug);
    expect(records.length).toBeGreaterThanOrEqual(4);
    expect(records.length).toBeLessThanOrEqual(6);
    for (const r of records) {
      expect(r.text.startsWith('SYNTHETIC — not a real patient. For software testing only.')).toBe(true);
      expect(r.text.length).toBeLessThan(MAX_RECORD_CHARS);
      expect(r.title.length).toBeGreaterThan(3);
      expect(sanitizeRecordText(r.text)).toBe(r.text.replace(/\n{3,}/g, '\n\n').trim());
    }
    const years = new Set(records.flatMap(r => r.text.match(/\b(?:19|20)\d{2}\b/g) ?? []));
    expect(years.size).toBeGreaterThanOrEqual(3);
  });
});
