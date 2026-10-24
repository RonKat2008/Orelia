import { describe, expect, it } from 'vitest';
import {
  checkRecordFile, checkRecordText, conflictEventIndex, defaultShareSections, filterEvents, formatPartialDate,
  groupByYear, kindCounts, kindsToParam, parseKinds, titleFromFilename, toggleKind, toggleSection, yearOf, UNDATED,
} from '@/components/history/model';
import { MAX_RECORD_CHARS, SHARE_SECTIONS, type Conflict, type HistoryEvent } from '@/lib/history/contract';

const ev = (id: string, date: string | null, kind: HistoryEvent['kind'] = 'lab'): HistoryEvent => ({
  id, date, kind, title: id, provider: null, institution: null, findings: [], sourceDocId: 'd1', span: { start: 0, end: 5 },
});

describe('groupByYear', () => {
  it('groups by year ascending with undated last', () => {
    const groups = groupByYear([ev('a', '2019-03'), ev('b', '2019-07-02'), ev('c', '2021'), ev('d', null)]);
    expect(groups.map(g => g.year)).toEqual(['2019', '2021', UNDATED]);
    expect(groups[0].events.map(e => e.id)).toEqual(['a', 'b']);
  });
  it('handles an empty list', () => expect(groupByYear([])).toEqual([]));
  it('yearOf slices the year', () => expect(yearOf('2020-05-01')).toBe('2020'));
});

describe('kind filters', () => {
  it('parses known kinds only and dedupes', () => {
    expect(parseKinds('lab,bogus,lab, imaging')).toEqual(['imaging', 'lab']);
    expect(parseKinds(null)).toEqual([]);
  });
  it('round-trips through the param', () => {
    expect(kindsToParam([])).toBeNull();
    expect(parseKinds(kindsToParam(['lab', 'diagnosis']))).toEqual(['diagnosis', 'lab']);
  });
  it('toggles', () => {
    expect(toggleKind([], 'lab')).toEqual(['lab']);
    expect(toggleKind(['lab'], 'lab')).toEqual([]);
  });
  it('empty selection shows all; otherwise filters', () => {
    const events = [ev('a', '2020', 'lab'), ev('b', '2020', 'imaging')];
    expect(filterEvents(events, [])).toHaveLength(2);
    expect(filterEvents(events, ['imaging']).map(e => e.id)).toEqual(['b']);
  });
  it('counts per kind', () => {
    const counts = kindCounts([ev('a', null, 'lab'), ev('b', null, 'lab')]);
    expect(counts.lab).toBe(2);
    expect(counts.diagnosis).toBe(0);
  });
});

describe('conflictEventIndex', () => {
  it('maps each quoted event to its conflicts', () => {
    const c: Conflict = {
      id: 'c1', kind: 'diagnosis', topic: 't', note: 'n',
      statements: [
        { eventId: 'a', sourceDocId: 'd1', docTitle: 'One', date: null, text: 'x' },
        { eventId: 'b', sourceDocId: 'd2', docTitle: 'Two', date: null, text: 'y' },
      ],
    };
    const index = conflictEventIndex([c]);
    expect(index.get('a')).toEqual([c]);
    expect(index.get('b')).toEqual([c]);
    expect(index.has('z')).toBe(false);
  });
});

describe('formatPartialDate', () => {
  it('respects precision', () => {
    expect(formatPartialDate('2019')).toBe('2019');
    expect(formatPartialDate('2019-03')).toBe('Mar 2019');
    expect(formatPartialDate('2019-03-07')).toBe('Mar 7, 2019');
    expect(formatPartialDate(null)).toBe('Date not given');
  });
});

describe('record files', () => {
  it('accepts PDFs (server extracts the text) and rejects unknown types', () => {
    expect(checkRecordFile('scan.PDF').ok).toBe(true);
    const docx = checkRecordFile('x.docx');
    expect(docx.ok).toBe(false);
    if (!docx.ok) expect(docx.message).toMatch(/paste/i);
  });
  it('accepts txt/md and derives a title', () => {
    expect(checkRecordFile('visit_note-2020.md')).toEqual({ ok: true, title: 'visit note 2020' });
    expect(titleFromFilename('a.txt')).toBe('a');
  });
  it('checks text length and emptiness', () => {
    expect(checkRecordText('a.txt', '  ').ok).toBe(false);
    expect(checkRecordText('a.txt', 'x'.repeat(MAX_RECORD_CHARS + 1)).ok).toBe(false);
    expect(checkRecordText('a.txt', 'ok').ok).toBe(true);
  });
});

describe('share sections', () => {
  it('defaults to every section and toggles in canonical order', () => {
    expect(defaultShareSections()).toEqual([...SHARE_SECTIONS]);
    expect(toggleSection(['lab', 'conflicts'], 'diagnosis')).toEqual(['diagnosis', 'lab', 'conflicts']);
    expect(toggleSection(['lab'], 'lab')).toEqual([]);
  });
});
