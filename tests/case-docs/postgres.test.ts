import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresDocumentStore } from '@/lib/case-docs/postgres-store';
import type { getDb } from '@/db/client';
import type { SQL } from 'drizzle-orm';

/** Inspect the real Drizzle predicate; no database or live migration needed. */
function capture() {
  let where: SQL | undefined;
  let limit: number | undefined;
  const query = {
    from: () => query,
    where: (predicate: SQL) => { where = predicate; return query; },
    orderBy: () => query,
    limit: (value: number) => { limit = value; return Promise.resolve([]); },
  };
  const db = { select: () => query } as unknown as ReturnType<typeof getDb>;
  return { store: new PostgresDocumentStore(db), sql: () => new PgDialect().sqlToQuery(where!), limit: () => limit };
}
describe('Postgres document search', () => {
  it('pushes tenant, contact, model and consent constraints into SQL before LIMIT', async () => {
    const test = capture();
    await test.store.search({ caseId: 'case-a', contactId: 'contact-a', query: 'x', allowedFields: ['diseaseName', 'intakeReport'], embedding: Array(1024).fill(0), embedModel: 'model-a', k: 3 });
    const { sql, params } = test.sql();
    expect(sql).toContain('"case_documents"."case_id" =');
    expect(sql).toContain('"case_documents"."contact_id" is null or');
    expect(sql).toContain('"case_documents"."embed_model" =');
    expect(sql).toContain('"case_documents"."shared_field" in');
    expect(sql).toContain("<> 'intake_report'");
    expect(params).toEqual(['case-a', 'model-a', 'contact-a', 'resource_page', 'evidence', 'diseaseName']);
    expect(test.limit()).toBe(3);
  });
  it('no contact sees only unscoped docs; empty consent allows only public kinds', async () => {
    const test = capture();
    await test.store.search({ caseId: 'case-a', query: 'x', allowedFields: ['intakeReport', 'unknown'], embedding: Array(1024).fill(0), embedModel: 'model-a' });
    const { sql, params } = test.sql();
    expect(sql).toContain('"contact_id" is null');
    expect(sql).not.toContain('"contact_id" =');
    expect(sql).toContain('false');
    expect(params).toEqual(['case-a', 'model-a', 'resource_page', 'evidence']);
  });
});
