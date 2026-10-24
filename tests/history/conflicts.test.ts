import { describe, expect, it } from 'vitest';
import { CONFLICT_NOTE, conflictSchema } from '@/lib/history/contract';
import { normalizeDiagnosis } from '@/lib/history/clinical-terms';
import { detectConflicts } from '@/lib/history/conflicts';
import { extractEventsWithRules } from '@/lib/history/extract';
import { fixtureEvents, makeDoc } from './helpers';

describe('normalizeDiagnosis', () => {
  it('treats synonyms as one name', () => {
    const keys = ['vEDS', 'Vascular Ehlers-Danlos syndrome', 'Ehlers-Danlos syndrome, vascular type (vEDS)', 'EDS type IV'].map(n => normalizeDiagnosis(n).key);
    expect(new Set(keys).size).toBe(1);
    expect(normalizeDiagnosis('hEDS').key).not.toBe(normalizeDiagnosis('vEDS').key);
    expect(normalizeDiagnosis('IgG4-RD').key).toBe(normalizeDiagnosis('Immunoglobulin G4-related disease').key);
  });
  it('ignores case, punctuation and hedges', () => {
    expect(normalizeDiagnosis('Suspected Chronic Sialadenitis.').key).toBe(normalizeDiagnosis('chronic sialadenitis').key);
  });
});

describe('detectConflicts on fixtures', () => {
  it('vascular-eds: diagnosis and variant classification', async () => {
    const { docs, events } = await fixtureEvents('vascular-eds');
    const conflicts = detectConflicts(docs, events);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    const diag = conflicts.find(c => c.kind === 'diagnosis')!;
    expect(diag.statements.map(s => s.text).join(' ')).toMatch(/hypermobile/i);
    expect(diag.statements.map(s => s.text).join(' ')).toMatch(/vascular|vEDS/i);
    const variant = conflicts.find(c => c.kind === 'variant_classification')!;
    expect(variant.topic).toContain('COL3A1');
    const text = variant.statements.map(s => s.text).join(' ');
    expect(text).toMatch(/Likely pathogenic/);
    expect(text).toMatch(/uncertain significance/i);
  });

  it('epithelioid-sarcoma: diagnosis and INI1 status', async () => {
    const { docs, events } = await fixtureEvents('epithelioid-sarcoma');
    const conflicts = detectConflicts(docs, events);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    const diag = conflicts.find(c => c.kind === 'diagnosis')!;
    expect(diag.statements.map(s => s.text).join(' ')).toMatch(/Granuloma annulare/);
    expect(diag.statements.map(s => s.text).join(' ')).toMatch(/Epithelioid sarcoma/);
    const other = conflicts.find(c => c.kind === 'other' && /INI1/.test(c.topic))!;
    const text = other.statements.map(s => s.text).join(' ');
    expect(text).toMatch(/retained/i);
    expect(text).toMatch(/LOST/);
  });

  it('igg4: diagnosis and medication', async () => {
    const { docs, events } = await fixtureEvents('igg4-related-disease');
    const conflicts = detectConflicts(docs, events);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    const diag = conflicts.find(c => c.kind === 'diagnosis')!;
    const text = diag.statements.map(s => s.text).join(' ');
    expect(text).toMatch(/adenocarcinoma/i);
    expect(text).toMatch(/IgG4/);
    const med = conflicts.find(c => c.kind === 'medication')!;
    expect(med.topic).toMatch(/Omeprazole/i);
  });

  it.each(['vascular-eds', 'epithelioid-sarcoma', 'igg4-related-disease'] as const)('%s: valid, stable, sourced from two docs, never resolved', async slug => {
    const { docs, events } = await fixtureEvents(slug);
    const a = detectConflicts(docs, events);
    const b = detectConflicts(docs, [...events].reverse());
    expect(b).toEqual(a);
    expect(new Set(a.map(c => c.id)).size).toBe(a.length);
    for (const c of a) {
      expect(conflictSchema.safeParse(c).success).toBe(true);
      expect(new Set(c.statements.map(s => s.sourceDocId)).size).toBeGreaterThanOrEqual(2);
      expect(c.note).toBe(CONFLICT_NOTE);
      for (const s of c.statements) {
        const doc = docs.find(d => d.id === s.sourceDocId)!;
        expect(doc.title).toBe(s.docTitle);
        expect(events.some(e => e.id === s.eventId)).toBe(true);
      }
    }
  });
});

describe('detectConflicts edge cases', () => {
  it('never reports a conflict inside a single document', () => {
    const doc = makeDoc('one', 'Notes', [
      '## 2019-01-01 — Visit', 'Diagnosis: hypermobile EDS', 'Medications: Prednisone 10 mg daily',
      '## 2021-01-01 — Visit', 'Diagnosis: vascular EDS', 'Medications: Prednisone 40 mg daily',
      'Gene: COL3A1', 'Variant: c.1834G>A', 'Classification: Pathogenic',
      '## 2022-01-01 — Visit', 'Gene: COL3A1', 'Variant: c.1834G>A', 'Classification: Uncertain significance',
    ].join('\n'));
    expect(detectConflicts([doc], extractEventsWithRules(doc))).toEqual([]);
  });

  it('does not flag different names for the same diagnosis', () => {
    const a = makeDoc('a', 'Note A', '## 2020-01-01 — Visit\nDiagnosis: vEDS');
    const b = makeDoc('b', 'Note B', '## 2021-01-01 — Visit\nDiagnosis: Vascular Ehlers-Danlos syndrome');
    expect(detectConflicts([a, b], [...extractEventsWithRules(a), ...extractEventsWithRules(b)])).toEqual([]);
  });

  it('reads classification from a table row and free text', () => {
    const a = makeDoc('a', 'Lab A', '## 2020-01-01 — Genetic report\n| Gene | Variant | Class |\n|---|---|---|\n| COL3A1 | c.100G>A | Pathogenic |');
    const b = makeDoc('b', 'Lab B', '## 2021-01-01 — Genetic report\nOur lab reports COL3A1 c.100G>A as likely benign.');
    const conflicts = detectConflicts([a, b], [...extractEventsWithRules(a), ...extractEventsWithRules(b)]);
    expect(conflicts.map(c => c.kind)).toEqual(['variant_classification']);
  });
});
