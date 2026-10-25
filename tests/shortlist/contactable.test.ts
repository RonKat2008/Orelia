import { describe, expect, it } from 'vitest';
import { isContactable, normalizeShortlist } from '../../components/shortlist/data';

const fetchedAt = '2026-10-23T12:00:00.000Z';
const email = { id: 'e1', claimType: 'contact_point.email.new_patient_line', claim: 'intake@example.org', sourceUrl: 'https://example.org/intake', sourceKind: 'exa', fetchedAt };
const program = { id: 'e2', claimType: 'program_page', claim: 'Has a program', sourceUrl: 'https://example.org/p', sourceKind: 'exa', fetchedAt };

const row = (targetId: string, evidence: unknown[], contactable?: boolean) => ({
  targetKind: 'organization', targetId, name: targetId, rank: 1, score: 1, selected: false, breakdown: [], evidence, ...(contactable === undefined ? {} : { contactable }),
});
const payload = (rows: unknown[]) => normalizeShortlist({ caseId: 'c', groups: { organization: rows } })!;

describe('isContactable', () => {
  it('honours the server flag', () => {
    const [a, b] = payload([row('a', [email], false), row('b', [program], true)]).items;
    expect(isContactable(a)).toBe(false);
    expect(isContactable(b)).toBe(true);
  });
  it('falls back to the shared reachability rule when the flag is absent', () => {
    const [a, b] = payload([row('a', [email]), row('b', [program])]).items;
    expect(isContactable(a)).toBe(true);
    expect(isContactable(b)).toBe(false);
  });
});
