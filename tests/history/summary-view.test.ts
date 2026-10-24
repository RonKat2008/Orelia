import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFLICT_NOTE } from '@/lib/history/contract';
import { HistorySummaryView } from '@/components/history/summary/HistorySummaryView';
import { formatPartialDate } from '@/components/history/summary/format';
import { ALL_SHARE_SECTIONS, buildSummary } from '@/lib/history/summary';
import { timeline } from './share-fixtures';

const now = new Date('2026-10-24T10:00:00Z');
const render = (sections: Parameters<typeof buildSummary>[1], props = {}) =>
  renderToStaticMarkup(createElement(HistorySummaryView, { summary: buildSummary(timeline, sections, now), title: 'Shared', titleLevel: 'h1', ...props }));

describe('HistorySummaryView', () => {
  it('shows date, title, provider, institution, findings and the source on each event', () => {
    const html = render(['diagnosis']);
    for (const t of ['Mar 12, 2024', 'Diagnosis alpha', 'Dr. Synthetic, Example Clinic', 'Finding alpha', 'Source: Genetics letter', 'Not a medical interpretation']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('<h1');
  });
  it('titles the conflicts section and includes the neutral note', () => {
    const html = render(['conflicts']);
    expect(html).toContain('Conflicts to discuss with your doctor');
    expect(html).toContain(CONFLICT_NOTE);
    expect(html).toContain('Statement one');
    expect(html).toContain('Source: Cardiology visit');
  });
  it('omits unticked sections entirely', () => {
    const html = render(['diagnosis']);
    expect(html).not.toContain('Visit bravo');
    expect(html).not.toContain('Secret lab report');
    expect(html).not.toContain('Conflicts to discuss');
  });
  it('renders every section when all are included', () => {
    const html = render(ALL_SHARE_SECTIONS);
    expect(html).toContain('Date not stated');
    expect(html).toContain('Lab charlie');
  });
});

describe('formatPartialDate', () => {
  it('keeps the precision the record gave', () => {
    expect(formatPartialDate('2025')).toBe('2025');
    expect(formatPartialDate('2025-05')).toBe('May 2025');
    expect(formatPartialDate('2025-05-07')).toBe('May 7, 2025');
    expect(formatPartialDate(null)).toBe('Date not stated');
  });
});
