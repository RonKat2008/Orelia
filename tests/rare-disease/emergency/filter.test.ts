import { describe, expect, it } from 'vitest';
import { buildCard, readsAsInstruction, screenText, shortUrl } from '@/lib/rare-disease/emergency/filter';
import { EMERGENCY_HEADER } from '@/lib/rare-disease/emergency/contract';
import { CASE_A, documents, events, inputs, needs } from './fixtures';

const diagnosed = () => buildCard({ caseId: CASE_A, undiagnosed: false, needs, events, documents, inputs });

describe('readsAsInstruction', () => {
  it.each([
    'You should seek emergency care.',
    'Seek care right away.',
    'Take your medicine with food.',
    'Avoid heavy lifting.',
    'Call 911 if pain starts.',
    'If pain starts, call 911.',
    'Do not lift heavy things.',
    "Don't play contact sports.",
    'Never ignore chest pain.',
    'Make sure to tell the doctor.',
    'Patients should carry a card.',
    'It is important to go to the emergency room.',
    'Your arteries are fragile.',
    'Please tell staff.',
  ])('flags %s', (text) => expect(readsAsInstruction(text)).toBe(true));

  it.each([
    'Arteries are fragile in this condition.',
    'Sources describe a higher risk of vessel injury during arteriography.',
    'Heterozygous pathogenic variant in COL3A1 c.2357G>A',
    'Diagnosis confirmed by the genetics team',
  ])('keeps %s', (text) => expect(readsAsInstruction(text)).toBe(false));
});

describe('screenText', () => {
  it('drops medical advice before anything else', () => {
    expect(screenText('Beta blockers are the best treatment for this condition.', { checkDiagnosis: false })).toBe('medical_advice');
  });
  it('drops diagnosis guesses only when asked to check', () => {
    const text = 'This could be a connective tissue disorder.';
    expect(screenText('Findings are consistent with Marfan syndrome.', { checkDiagnosis: true })).toBe('diagnosis_guess');
    expect(screenText(text, { checkDiagnosis: false })).toBeNull();
  });
});

describe('buildCard (diagnosed)', () => {
  it('keeps only sourced staff facts, each with resolvable source urls', () => {
    const { content } = diagnosed();
    expect(content.header).toBe(EMERGENCY_HEADER);
    expect(content.facts.map((f) => f.id)).toEqual(['emer-1', 'emer-2']);
    expect(content.facts[1].sources.map((s) => s.url)).toEqual(['https://www.ncbi.nlm.nih.gov/books/NBK222/', 'https://pubmed.ncbi.nlm.nih.gov/111/']);
    expect(content.facts[0].sources[0].short).toBe('pubmed.ncbi.nlm.nih.gov/111');
  });

  it('records each dropped line with a reason', () => {
    const reasons = Object.fromEntries(diagnosed().dropped.map((d) => [d.id, d.reason]));
    expect(reasons).toMatchObject({
      'emer-3': 'instruction', 'emer-4': 'unsourced', 'emer-5': 'instruction', 'emer-6': 'instruction', 'emer-7': 'medical_advice',
    });
  });

  it('quotes diagnosis and genetic test records with their document title and date', () => {
    const { content } = diagnosed();
    expect(content.records.map((r) => r.id)).toEqual(['e1', 'e2']);
    expect(content.records[0]).toMatchObject({ kind: 'diagnosis', docTitle: 'Genetics letter', date: '2024-03-12' });
    expect(content.records[1].findings).toEqual(['Heterozygous pathogenic variant in COL3A1 c.2357G>A']);
  });

  it('drops an instruction-like finding and a record whose document is gone', () => {
    const dropped = diagnosed().dropped;
    expect(dropped.find((d) => d.text === 'You should avoid contact sports.')?.reason).toBe('instruction');
    expect(dropped.find((d) => d.id === 'e4')?.reason).toBe('unsourced');
  });

  it('includes the patient-entered contacts and care team', () => {
    const { content } = diagnosed();
    expect(content.contacts).toEqual(inputs.contacts);
    expect(content.careTeam).toEqual(inputs.careTeam);
  });

  it('does not mutate its inputs', () => {
    const before = JSON.stringify({ needs, events, inputs });
    diagnosed();
    expect(JSON.stringify({ needs, events, inputs })).toBe(before);
  });
});

describe('buildCard (undiagnosed)', () => {
  it('shows no condition facts and only genetic test results', () => {
    const { content } = buildCard({ caseId: CASE_A, undiagnosed: true, needs, events, documents, inputs });
    expect(content.facts).toEqual([]);
    expect(content.records.map((r) => r.kind)).toEqual(['genetic_test']);
  });

  it('drops patient-entered lines that name a condition', () => {
    const named = { contacts: [], careTeam: [{ name: 'Clinic nurse', role: 'Marfan syndrome clinic', phone: '555-010-4000' }] };
    const { content, dropped } = buildCard({ caseId: CASE_A, undiagnosed: true, needs: null, events: [], documents: [], inputs: named });
    expect(content.careTeam).toEqual([]);
    expect(dropped[0].reason).toBe('diagnosis_guess');
  });
});

describe('shortUrl', () => {
  it('strips the scheme, www and trailing slash and caps the length', () => {
    expect(shortUrl('https://www.ncbi.nlm.nih.gov/books/NBK222/')).toBe('ncbi.nlm.nih.gov/books/NBK222');
    expect(shortUrl(`https://example.org/${'a'.repeat(80)}`).length).toBeLessThanOrEqual(48);
    expect(shortUrl('not a url')).toBe('not a url');
  });
});
