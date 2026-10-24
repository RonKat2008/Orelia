import { describe, expect, it, vi } from 'vitest';
import { extractEvents, extractEventsWithRules } from '@/lib/history/extract';
import { makeDoc } from './helpers';

const LAB = [
  'SYNTHETIC — not a real patient. For software testing only.',
  '',
  '# Variant reanalysis report — Test Patient',
  '',
  'Laboratory: Brightwater Clinical Genomics',
  'Referring physician: Dr. Tobias Wren-Alvarado',
  '',
  '## 04/22/2025 — Exome reanalysis (research reflex)',
  '',
  'Gene: COL3A1',
  'Classification: Variant of uncertain significance (VUS)',
  '',
].join('\n');

describe('history extraction: provider (person) vs institution (organization)', () => {
  it('does not make the referring physician the provider of a lab record', () => {
    const events = extractEventsWithRules(makeDoc('lab', 'Variant reanalysis report', LAB));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.provider).toBeNull();
      expect(e.institution).toBe('Brightwater Clinical Genomics');
    }
  });

  it('still reads the performing clinician when one is labelled', () => {
    const text = 'Clinic: Harbor Genetics Clinic\nReferred by: Dr. Ann Referrer\nSeen by: Dr. Jo Visit\n\n## 2024-02-01 — Genetics visit\nDiagnosis: vascular EDS suspected\n';
    const [e] = extractEventsWithRules(makeDoc('v', 'Genetics visit', text));
    expect(e!.provider).toBe('Dr. Jo Visit');
    expect(e!.institution).toBe('Harbor Genetics Clinic');
  });

  it('ignores a Dr. name that only appears on a referral / cc line', () => {
    const text = 'Facility: Harbor Imaging Center\ncc: Dr. Pat Copy\nReferring provider: Dr. Ann Referrer\n\n## 2024-03-01 — CT angiogram\nFindings: no dissection\n';
    const [e] = extractEventsWithRules(makeDoc('i', 'CT angiogram', text));
    expect(e!.provider).toBeNull();
  });

  it('drops an LLM provider that only appears as the referring physician', async () => {
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify({ events: [{
      date: '2025-04-22', kind: 'genetic_test', title: 'Exome reanalysis (research reflex)',
      provider: 'Dr. Tobias Wren-Alvarado', institution: 'Brightwater Clinical Genomics',
      findings: ['Gene: COL3A1'],
    }] }));
    const r = await extractEvents(makeDoc('lab', 'Variant reanalysis report', LAB), { llm: true, chatFn });
    expect(r.extractedBy).toBe('llm');
    expect(r.events[0]!.provider).toBeNull();
    expect(r.events[0]!.institution).toBe('Brightwater Clinical Genomics');
  });
});
