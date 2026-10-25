import type { HistoryDocument, HistoryEvent } from '@/lib/history/contract';
import type { CardInputs, NeedsForCard } from '@/lib/rare-disease/emergency/contract';

export const CASE_A = '11111111-1111-4111-8111-111111111111';
export const CASE_B = '22222222-2222-4222-8222-222222222222';

/** Synthetic sourced facts: two staff facts, one instruction to the patient, one unsourced, one advice. */
export const needs: NeedsForCard = {
  emergencyFacts: [
    { id: 'emer-1', text: 'Arteries are fragile in this condition; sources describe a higher risk of vessel injury during arteriography.', evidenceIds: ['pubmed:111'] },
    { id: 'emer-2', text: 'Sources describe sudden artery tears and organ rupture as known complications.', evidenceIds: ['pubmed:222', 'pubmed:111'] },
    { id: 'emer-3', text: 'You should seek emergency care right away if you feel sudden pain.', evidenceIds: ['pubmed:111'] },
    { id: 'emer-4', text: 'Bruising is common in this condition.', evidenceIds: ['pubmed:missing'] },
    { id: 'emer-5', text: 'Avoid contact sports and heavy lifting.', evidenceIds: ['pubmed:222'] },
    { id: 'emer-6', text: 'Call 911 when chest pain starts.', evidenceIds: ['pubmed:222'] },
    { id: 'emer-7', text: 'Beta blockers are the best treatment for this condition.', evidenceIds: ['pubmed:222'] },
  ],
  sources: [
    { id: 'pubmed:111', url: 'https://pubmed.ncbi.nlm.nih.gov/111/', title: 'Synthetic review one', kind: 'pubmed', fetchedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'pubmed:222', url: 'https://www.ncbi.nlm.nih.gov/books/NBK222/', title: 'Synthetic review two', kind: 'genereviews', fetchedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

const ev = (id: string, kind: HistoryEvent['kind'], title: string, doc: string, date: string | null, findings: string[]): HistoryEvent => ({
  id, kind, title, date, provider: 'Dr. Synthetic', institution: 'Example Clinic', findings, sourceDocId: doc, span: { start: 0, end: 10 },
});

export const documents: Pick<HistoryDocument, 'id' | 'title'>[] = [
  { id: 'd1', title: 'Genetics letter' },
  { id: 'd2', title: 'Lab report from Example Lab' },
];

export const events: HistoryEvent[] = [
  ev('e1', 'diagnosis', 'Vascular Ehlers-Danlos syndrome confirmed', 'd1', '2024-03-12', ['Diagnosis confirmed by the genetics team']),
  ev('e2', 'genetic_test', 'COL3A1 genetic test', 'd2', '2024-02', ['Heterozygous pathogenic variant in COL3A1 c.2357G>A', 'You should avoid contact sports.']),
  ev('e3', 'lab', 'Blood count', 'd2', null, ['Normal blood count']),
  ev('e4', 'genetic_test', 'Panel from an unknown document', 'gone', '2023', ['Result text']),
];

export const inputs: CardInputs = {
  contacts: [{ name: 'Jordan Rivera', relationship: 'Partner', phone: '(555) 010-2000' }],
  careTeam: [{ name: 'Dr. Synthetic', role: 'Genetics doctor', phone: '555-010-3000' }],
};
