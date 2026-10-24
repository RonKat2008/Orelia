import type { Conflict, HistoryEvent, HistoryTimeline } from '@/lib/history/contract';

export const CASE_A = '11111111-1111-4111-8111-111111111111';
export const CASE_B = '22222222-2222-4222-8222-222222222222';

const ev = (id: string, kind: HistoryEvent['kind'], title: string, doc: string, date: string | null, findings: string[]): HistoryEvent => ({
  id, kind, title, date, provider: 'Dr. Synthetic', institution: 'Example Clinic', findings, sourceDocId: doc, span: { start: 0, end: 10 },
});

export const timeline: HistoryTimeline = {
  documents: [
    { id: 'd1', caseId: CASE_A, title: 'Genetics letter', docType: 'letter', createdAt: '2026-01-01T00:00:00Z', extractedBy: 'rules' },
    { id: 'd2', caseId: CASE_A, title: 'Cardiology visit', docType: 'visit_note', createdAt: '2026-01-02T00:00:00Z', extractedBy: 'rules' },
    { id: 'd3', caseId: CASE_A, title: 'Secret lab report', docType: 'lab_report', createdAt: '2026-01-03T00:00:00Z', extractedBy: 'rules' },
  ],
  events: [
    ev('e1', 'diagnosis', 'Diagnosis alpha', 'd1', '2024-03-12', ['Finding alpha']),
    ev('e2', 'specialist_visit', 'Visit bravo', 'd2', '2025-05', ['Finding bravo']),
    ev('e3', 'lab', 'Lab charlie', 'd3', null, ['Finding charlie-secret']),
  ],
  conflicts: [{
    id: 'c1', kind: 'diagnosis', topic: 'Topic delta', note: 'Discuss with your doctor.',
    statements: [
      { eventId: 'e1', sourceDocId: 'd1', docTitle: 'Genetics letter', date: '2024-03-12', text: 'Statement one' },
      { eventId: 'e2', sourceDocId: 'd2', docTitle: 'Cardiology visit', date: '2025-05', text: 'Statement two' },
    ],
  } satisfies Conflict],
};
