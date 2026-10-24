import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '../../db/schema';

/**
 * Minimal in-memory Postgres stand-in behind drizzle's pg-proxy driver: it answers SELECTs on a single table by
 * applying the query's `"table"."col" = $n` and `in ($n, ...)` predicates. Enough to prove the evidence queries are
 * scoped by case; a query that forgets the case filter returns other cases' rows here exactly as Postgres would.
 */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const queries: string[] = [];

function evaluate(query: string, params: unknown[]): unknown[][] {
  queries.push(query);
  const table = /from "(\w+)"/.exec(query)?.[1];
  if (!table) return [];
  const columns = [...(/^select (.*?) from/.exec(query)?.[1] ?? '').matchAll(/"(\w+)"(?:\s*,|\s*$)/g)].map(m => m[1]);
  const where = query.split(' where ')[1] ?? '';
  const preds: [string, unknown[]][] = [];
  for (const m of where.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)) preds.push([m[1], [params[Number(m[2]) - 1]]]);
  for (const m of where.matchAll(/"\w+"\."(\w+)" in \(([^)]*)\)/g)) preds.push([m[1], [...m[2].matchAll(/\$(\d+)/g)].map(x => params[Number(x[1]) - 1])]);
  return (tables[table] ?? []).filter(r => preds.every(([col, vals]) => vals.includes(r[col]))).map(r => columns.map(c => r[c] ?? null));
}

const db = drizzle(async (query, params) => ({ rows: evaluate(query, params) }), { schema });
vi.mock('../../db/client', () => ({ getDb: () => db }));

const { PostgresOutreachStore } = await import('../../lib/outreach/postgres-store');
const { DbPersist } = await import('../../lib/agents/persist');

const caseA = crypto.randomUUID();
const caseB = crypto.randomUUID();
const target = crypto.randomUUID(); // the same institution shortlisted in both cases
const ev = (caseId: string, claim: string) => ({
  id: crypto.randomUUID(), case_id: caseId, target_kind: 'institution', target_id: target, claim_type: 'disease_program', claim,
  source_url: 'https://example.org/program', source_kind: 'exa', fetched_at: '2026-10-23T00:00:00.000Z',
});
const cand = (caseId: string) => ({ id: crypto.randomUUID(), case_id: caseId, target_kind: 'institution', target_id: target, rank: 1, score: 50, score_breakdown: [], selected: false });

beforeEach(() => {
  queries.length = 0;
  tables.evidence = [];
  tables.case_candidates = [];
  tables.institutions = [{ id: target, name: 'Sarcoma Center', kind: 'hospital', nci_designated: false }];
});

describe('evidence reads are scoped to the case (M5)', () => {
  it('outreach candidates never carry another case\'s evidence', async () => {
    const a = cand(caseA); const b = cand(caseB);
    tables.case_candidates = [a, b];
    tables.evidence = [ev(caseB, 'contact_point evidence from case B only')];
    const store = new PostgresOutreachStore();
    const [candidate] = await store.candidates(caseA, [a.id]);
    expect(candidate.evidence).toEqual([]);
    expect(queries.find(q => q.includes('from "evidence"'))).toContain('"evidence"."case_id" = $');
  });

  it('outreach candidates see their own case\'s evidence', async () => {
    const a = cand(caseA);
    tables.case_candidates = [a];
    tables.evidence = [ev(caseA, 'case A claim'), ev(caseB, 'case B claim')];
    const [candidate] = await new PostgresOutreachStore().candidates(caseA, [a.id]);
    expect(candidate.evidence.map(e => e.claim)).toEqual(['case A claim']);
  });

  it('the shortlist for a case returns nothing from another case\'s evidence', async () => {
    tables.case_candidates = [cand(caseA)];
    tables.evidence = [ev(caseB, 'case B claim')];
    const persist = new DbPersist(db as unknown as ConstructorParameters<typeof DbPersist>[0]);
    const [item] = await persist.getShortlist(caseA);
    expect(item.evidence).toEqual([]);
  });
});
