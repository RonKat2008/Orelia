/**
 * Deletes synthetic QA / smoke-test cases from the database named by DATABASE_URL.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/cleanup-smoke-cases.ts                 # list only (dry run)
 *   npx tsx scripts/cleanup-smoke-cases.ts --apply         # delete everything except the kept demo case(s)
 *   npx tsx scripts/cleanup-smoke-cases.ts --apply --keep <uuid> --keep <uuid>
 *
 * Every case in this product's database is synthetic (no PHI), but deleting is irreversible, so: dry run by default,
 * the demo case is always kept, and the script refuses to run unless every foreign key to cases / contacts / tasks is
 * ON DELETE CASCADE (migration 0039), so a delete can never leave orphans or fail halfway.
 */
import { neon } from "@neondatabase/serverless";

/** The newest vEDS case, kept as the live demo case. */
export const DEMO_CASE_ID = "41199b08-a47a-4c87-b23e-8c4d158d495d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CaseRow { id: string; disease: string; createdAt: string }

export function parseArgs(argv: string[]): { apply: boolean; keep: string[] } {
  const keep = new Set<string>([DEMO_CASE_ID]);
  argv.forEach((a, i) => {
    if (a !== "--keep") return;
    const id = (argv[i + 1] ?? "").toLowerCase();
    if (!UUID.test(id)) throw new Error(`--keep needs a case uuid, got "${argv[i + 1] ?? ""}"`);
    keep.add(id);
  });
  return { apply: argv.includes("--apply"), keep: [...keep] };
}

/** Pure selection: everything not explicitly kept. */
export function casesToDelete(rows: readonly CaseRow[], keep: readonly string[]): CaseRow[] {
  const kept = new Set(keep.map((k) => k.toLowerCase()));
  return rows.filter((r) => !kept.has(r.id.toLowerCase()));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (source .env.local first)");
  const { apply, keep } = parseArgs(process.argv.slice(2));
  const sql = neon(url);

  const [{ nc }] = (await sql`
    select count(*)::int as nc from pg_constraint
    where contype = 'f' and confdeltype <> 'c' and connamespace = 'public'::regnamespace
      and confrelid in ('public.cases'::regclass, 'public.contacts'::regclass, 'public.tasks'::regclass)`) as { nc: number }[];
  if (nc > 0) throw new Error(`${nc} foreign key(s) are not ON DELETE CASCADE. Run \`npm run db:migrate\` first.`);

  const load = async (): Promise<CaseRow[]> =>
    ((await sql`select id, disease_name, created_at from cases order by created_at desc`) as { id: string; disease_name: string; created_at: Date | string }[])
      .map((r) => ({ id: r.id, disease: r.disease_name, createdAt: new Date(r.created_at).toISOString() }));

  const before = await load();
  console.log(`cases before: ${before.length}`);
  for (const r of before) console.log(`  ${keep.includes(r.id) ? "KEEP  " : "delete"} ${r.id}  ${r.disease}  ${r.createdAt}`);
  const doomed = casesToDelete(before, keep);
  if (!apply) {
    console.log(`dry run: would delete ${doomed.length}, keep ${before.length - doomed.length}. Re-run with --apply.`);
    return;
  }
  for (const r of doomed) await sql`delete from cases where id = ${r.id}::uuid`;
  const after = await load();
  console.log(`deleted ${doomed.length}; cases after: ${after.length}`);
  for (const r of after) console.log(`  ${r.id}  ${r.disease}  ${r.createdAt}`);
}

import { fileURLToPath } from "node:url";
import path from "node:path";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
