/**
 * Record fixtures/llm/condition-brief/<slug>.json by running the LIVE generator over sources collected OFFLINE
 * from fixtures/api. Only diseaseName + sources reach the model (no patient fields).
 * Recorded fixtures were hand-cleaned afterwards so every statement passes validate.ts (see offline-fixtures test).
 * Run: set -a; . ./.env.local; set +a; npx tsx scripts/record-condition-brief-llm.ts [--case <slug>]
 */
const CASES = [
  { slug: "epithelioid-sarcoma", diseaseName: "Epithelioid sarcoma" },
  { slug: "vascular-eds", diseaseName: "Vascular Ehlers-Danlos syndrome" },
  { slug: "igg4-related-disease", diseaseName: "IgG4-related disease" },
] as const;
const FIXED_NOW = new Date("2026-10-24T12:00:00Z");
/** Hard cap per live generation: a hung gateway call must never stall recording. */
const GENERATE_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  // Live chat, offline sources: do NOT set WAYFINDER_OFFLINE.
  delete process.env.WAYFINDER_OFFLINE;
  const only = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : undefined;
  const { FixtureTransport } = await import("@/lib/sources/transport");
  const { collectAll } = await import("@/lib/condition-brief/sources");
  const { generateBrief } = await import("@/lib/condition-brief/generate");
  const { fixtureSlugFor } = await import("@/lib/condition-brief/build");
  const { validateBrief } = await import("@/lib/condition-brief/validate");

  for (const c of CASES) {
    if (only && only !== c.slug) continue;
    if (fixtureSlugFor(c.diseaseName) !== c.slug) throw new Error(`slug mismatch for ${c.diseaseName}`);
    const collected = await collectAll(c.diseaseName, {
      transport: new FixtureTransport(),
      offline: true,
      fixtureSlug: c.slug,
      now: FIXED_NOW,
    });
    console.log(`\n== ${c.slug}: ${collected.sources.length} sources, ${collected.errors.length} collector errors`);
    const generated = await withTimeout(
      generateBrief(collected, { offline: false, fixtureSlug: c.slug, record: true }),
      GENERATE_TIMEOUT_MS,
      `generate ${c.slug}`,
    );
    const v = validateBrief(generated, collected);
    const bySection: Record<string, number> = {};
    for (const s of v.statements) bySection[`${s.section}/${s.evidenceLevel}`] = (bySection[`${s.section}/${s.evidenceLevel}`] ?? 0) + 1;
    console.log(`kept ${v.statements.length}/${generated.statements.length} statements, ${v.questions.length}/${generated.questions.length} questions`);
    console.log(JSON.stringify(bySection));
    for (const d of v.dropped) console.log(`  dropped ${d.id}: ${d.reason}`);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

export {};
