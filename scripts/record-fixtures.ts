// Records raw API responses (no reshaping) for offline tests.
// Run: node --experimental-strip-types scripts/record-fixtures.ts
// Strict mode (large disease-specific PubMed set + NPPES for its top authors, saved as NEW files):
//   npx tsx scripts/record-fixtures.ts --strict [--only <slug>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'fixtures', 'api');
const USER_AGENT = 'wayfinder-fixture-recorder/0.1 (rare-disease navigator; contact dev@example.com)';
const NCBI_API_KEY = process.env.NCBI_API_KEY ?? '';
const EXA_API_KEY = process.env.EXA_API_KEY ?? '';
const NCBI_SLEEP_MS = 400;
const POLITE_SLEEP_MS = 250;
const NPPES_PER_DISEASE = 8;
const STRICT = process.argv.includes('--strict');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const STRICT_RETMAX = 300;
const STRICT_EFETCH_BATCH = 100;
const STRICT_NPPES_AUTHORS = 25;
const STRICT_MIN_PAPERS = 2;
// NCBI allows 10 req/s with a key, 3/s without.
const STRICT_NCBI_SLEEP_MS = NCBI_API_KEY ? 110 : 350;

const DISEASES: Array<{ slug: string; term: string; extraTiab?: string[]; ambiguous: { last: string; first: string } }> = [
  { slug: 'epithelioid-sarcoma', term: 'epithelioid sarcoma', ambiguous: { last: 'Smith', first: 'Michael' } },
  { slug: 'vascular-eds', term: 'vascular Ehlers-Danlos syndrome', ambiguous: { last: 'Johnson', first: 'David' } },
  { slug: 'igg4-related-disease', term: 'IgG4-related disease', extraTiab: ['IgG4-related'], ambiguous: { last: 'Williams', first: 'James' } },
];

/** Strict PubMed query: disease in title/abstract or MeSH (plus synonyms), human studies only. */
export function strictPubmedTerm(d: { term: string; extraTiab?: string[] }): string {
  const clauses = [`"${d.term}"[tiab]`, `"${d.term}"[MeSH Terms]`, ...(d.extraTiab ?? []).map((t) => `"${t}"[tiab]`)];
  return `(${clauses.join(' OR ')}) AND humans[MeSH Terms]`;
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};
const STATE_CODES = new Set(Object.values(US_STATES));

interface ManifestEntry { file: string; method: string; url: string; status: number; fetched_at: string }
const manifest: ManifestEntry[] = [];
const errors: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(rel: string, body: string): void {
  const full = join(OUT_DIR, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function stripKeys(url: string): string {
  const u = new URL(url);
  for (const k of ['api_key', 'apikey', 'key']) u.searchParams.delete(k);
  return u.toString();
}

interface Recorded { status: number; text: string }

// Fetch + save raw body + add manifest entry. Never throws.
async function record(
  rel: string,
  method: 'GET' | 'POST',
  url: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<Recorded> {
  const fetchedAt = new Date().toISOString();
  let status = 0;
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers ?? {}) },
        body: opts.body,
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      status = 0;
      text = JSON.stringify({ network_error: String(err) });
    }
    if (status !== 429 && status < 500) break;
    console.warn(`  ${status} on ${rel}, retrying once after 2s`);
    await sleep(2000);
  }
  save(rel, text);
  manifest.push({ file: rel, method, url: stripKeys(url), status, fetched_at: fetchedAt });
  if (status < 200 || status >= 300) errors.push(`${status} ${rel}`);
  console.log(`${status} ${rel} (${text.length} bytes)`);
  return { status, text };
}

function ncbiUrl(endpoint: string, params: Record<string, string>): string {
  const u = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('tool', 'wayfinder');
  u.searchParams.set('email', 'dev@example.com');
  if (NCBI_API_KEY) u.searchParams.set('api_key', NCBI_API_KEY);
  return u.toString();
}

interface Author { last: string; first: string; state: string | null }

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function stateFromAffiliation(aff: string): string | null {
  const text = decode(aff);
  for (const [name, code] of Object.entries(US_STATES)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return code;
  }
  const m = text.match(/,\s*([A-Z]{2})\b[ ,.\d-]*(?:USA|United States)?\s*\.?\s*$/);
  if (m && STATE_CODES.has(m[1])) return m[1];
  const m2 = text.match(/\b([A-Z]{2})\s+\d{5}/);
  if (m2 && STATE_CODES.has(m2[1])) return m2[1];
  return null;
}

function isUsAffiliation(aff: string): boolean {
  return /\bUSA\b|\bUnited States\b|\bU\.S\.A\b/.test(aff) || stateFromAffiliation(aff) !== null;
}

function parseUsAuthors(xml: string): Author[] {
  const found: Author[] = [];
  const seen = new Set<string>();
  for (const authorBlock of xml.match(/<Author\b[\s\S]*?<\/Author>/g) ?? []) {
    const last = authorBlock.match(/<LastName>([^<]+)<\/LastName>/)?.[1];
    const fore = authorBlock.match(/<ForeName>([^<]+)<\/ForeName>/)?.[1];
    if (!last || !fore) continue;
    const affs = [...authorBlock.matchAll(/<Affiliation>([^<]+)<\/Affiliation>/g)].map((m) => m[1]);
    const us = affs.find(isUsAffiliation);
    if (!us) continue;
    const first = decode(fore).split(/\s+/)[0].replace(/[^\p{L}-]/gu, '');
    const lastName = decode(last).trim();
    if (first.length < 2) continue; // NPPES needs >=2 chars to be useful
    const key = `${lastName}|${first}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ last: lastName, first, state: stateFromAffiliation(us) });
  }
  return found;
}

const slugPart = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function nppesUrl(a: { first: string; last: string; state?: string | null }): string {
  const u = new URL('https://npiregistry.cms.hhs.gov/api/');
  u.searchParams.set('version', '2.1');
  u.searchParams.set('first_name', a.first);
  u.searchParams.set('last_name', a.last);
  if (a.state) u.searchParams.set('state', a.state);
  u.searchParams.set('limit', '10');
  return u.toString();
}

async function recordDisease(d: (typeof DISEASES)[number]): Promise<void> {
  console.log(`\n== ${d.slug} ==`);
  const base = (src: string) => `${src}/${d.slug}`;

  // PubMed esearch
  await sleep(NCBI_SLEEP_MS);
  const es = await record(
    `${base('pubmed')}/esearch.json`, 'GET',
    ncbiUrl('esearch.fcgi', { db: 'pubmed', term: d.term, retmax: '50', retmode: 'json', sort: 'relevance' }),
  );
  let ids: string[] = [];
  try { ids = JSON.parse(es.text)?.esearchresult?.idlist ?? []; } catch { /* recorded status already */ }

  // PubMed efetch
  let efetchXml = '';
  if (ids.length > 0) {
    await sleep(NCBI_SLEEP_MS);
    const ef = await record(
      `${base('pubmed')}/efetch.xml`, 'GET',
      ncbiUrl('efetch.fcgi', { db: 'pubmed', id: ids.slice(0, 50).join(','), retmode: 'xml' }),
    );
    efetchXml = ef.text;
  }

  // ClinicalTrials.gov
  const ctg = new URL('https://clinicaltrials.gov/api/v2/studies');
  ctg.searchParams.set('query.cond', d.term);
  ctg.searchParams.set('filter.overallStatus', 'RECRUITING');
  ctg.searchParams.set('pageSize', '20');
  const c1 = await record(`${base('ctgov')}/studies.json`, 'GET', ctg.toString());
  let token: string | undefined;
  try { token = JSON.parse(c1.text)?.nextPageToken; } catch { /* ignore */ }
  if (token) {
    await sleep(POLITE_SLEEP_MS);
    const p2 = new URL(ctg.toString());
    p2.searchParams.set('pageToken', token);
    await record(`${base('ctgov')}/studies-page2.json`, 'GET', p2.toString());
  }

  // NPPES
  const authors = parseUsAuthors(efetchXml).slice(0, NPPES_PER_DISEASE);
  console.log(`  ${authors.length} US authors selected for NPPES`);
  for (const a of authors) {
    await sleep(POLITE_SLEEP_MS);
    await record(`${base('nppes')}/${slugPart(a.last)}-${slugPart(a.first)}.json`, 'GET', nppesUrl(a));
  }
  await sleep(POLITE_SLEEP_MS);
  await record(`${base('nppes')}/ambiguous-${slugPart(d.ambiguous.last)}.json`, 'GET', nppesUrl(d.ambiguous));

  // Exa
  if (EXA_API_KEY) {
    const queries = [
      `${d.term} patient advocacy foundation`,
      `${d.term} financial assistance OR travel assistance for patients`,
      `${d.term} center of excellence clinic`,
    ];
    for (let i = 0; i < queries.length; i++) {
      await sleep(POLITE_SLEEP_MS);
      await record(`${base('exa')}/${i + 1}.json`, 'POST', 'https://api.exa.ai/search', {
        headers: { 'Content-Type': 'application/json', 'x-api-key': EXA_API_KEY },
        body: JSON.stringify({ query: queries[i], numResults: 8, contents: { text: { maxCharacters: 2000 } } }),
      });
    }
  }
}

// ---- Strict mode -----------------------------------------------------------------------------------------------

interface StrictAuthor { first: string; last: string; state: string | null; isUs: boolean; pmids: Set<string> }

/**
 * Distinct-PMID author aggregation (same name key the fixture ports use). Papers count whether or not that
 * particular paper carries an affiliation; an author qualifies for NPPES if any paper shows a US affiliation.
 */
function aggregateStrictAuthors(xmls: string[]): StrictAuthor[] {
  const byKey = new Map<string, StrictAuthor>();
  for (const xml of xmls) {
    for (const article of xml.split(/<(?=PubmedArticle>)/).slice(1)) {
      const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
      if (!pmid) continue;
      const list = article.match(/<AuthorList(?![^>]*editors)[^>]*>[\s\S]*?<\/AuthorList>/)?.[0] ?? '';
      const us = new Map(parseUsAuthors(list).map((a) => [`${a.first} ${a.last}`.toLowerCase(), a]));
      for (const block of list.match(/<Author\b[\s\S]*?<\/Author>/g) ?? []) {
        const last = block.match(/<LastName>([^<]+)<\/LastName>/)?.[1];
        const fore = block.match(/<ForeName>([^<]+)<\/ForeName>/)?.[1];
        if (!last || !fore) continue;
        const first = decode(fore).split(/\s+/)[0].replace(/[^\p{L}-]/gu, '');
        if (first.length < 2) continue;
        const lastName = decode(last).trim();
        const key = `${first} ${lastName}`.toLowerCase();
        const cur = byKey.get(key) ?? { first, last: lastName, state: null, isUs: false, pmids: new Set<string>() };
        cur.pmids.add(pmid);
        const hit = us.get(key);
        if (hit) { cur.isUs = true; cur.state = cur.state ?? hit.state; }
        byKey.set(key, cur);
      }
    }
  }
  return [...byKey.values()]
    .filter((a) => a.isUs)
    .sort((a, b) => b.pmids.size - a.pmids.size || a.last.localeCompare(b.last));
}

// File names must match lib/agents/research/fixture-ports.ts (no diacritic folding there).
const portSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const asciiName = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

async function recordStrictDisease(d: (typeof DISEASES)[number]): Promise<void> {
  console.log(`\n== strict ${d.slug} ==`);
  const base = (src: string) => `${src}/${d.slug}`;
  await sleep(STRICT_NCBI_SLEEP_MS);
  const es = await record(
    `${base('pubmed')}/esearch-strict.json`, 'GET',
    ncbiUrl('esearch.fcgi', {
      db: 'pubmed', term: strictPubmedTerm(d), retmax: String(STRICT_RETMAX), retmode: 'json', sort: 'relevance',
    }),
  );
  let ids: string[] = [];
  try { ids = JSON.parse(es.text)?.esearchresult?.idlist ?? []; } catch { /* status recorded */ }
  const xmls: string[] = [];
  for (let i = 0; i * STRICT_EFETCH_BATCH < ids.length; i++) {
    await sleep(STRICT_NCBI_SLEEP_MS);
    const batch = ids.slice(i * STRICT_EFETCH_BATCH, (i + 1) * STRICT_EFETCH_BATCH);
    const ef = await record(
      `${base('pubmed')}/efetch-strict-${i + 1}.xml`, 'GET',
      ncbiUrl('efetch.fcgi', { db: 'pubmed', id: batch.join(','), retmode: 'xml' }),
    );
    xmls.push(ef.text);
  }
  const candidates = aggregateStrictAuthors(xmls).filter((a) => a.pmids.size >= STRICT_MIN_PAPERS);
  console.log(`  ${ids.length} strict papers; ${candidates.length} US authors with >=${STRICT_MIN_PAPERS} papers`);
  for (const a of candidates.slice(0, STRICT_NPPES_AUTHORS)) {
    await sleep(POLITE_SLEEP_MS);
    await record(
      `${base('nppes')}/strict-${portSlug(a.last)}-${portSlug(a.first)}.json`, 'GET',
      nppesUrl({ first: asciiName(a.first), last: asciiName(a.last), state: a.state }),
    );
  }
}

async function mainStrict(): Promise<void> {
  console.log(`STRICT mode; NCBI_API_KEY ${NCBI_API_KEY ? 'set' : 'not set'}`);
  const manifestPath = join(OUT_DIR, 'MANIFEST.json');
  const existing: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  for (const d of DISEASES) if (!ONLY || d.slug === ONLY) await recordStrictDisease(d);
  const fresh = new Set(manifest.map((m) => m.file));
  save('MANIFEST.json', JSON.stringify([...existing.filter((m) => !fresh.has(m.file)), ...manifest], null, 2) + '\n');
  console.log(`\nAdded ${manifest.length} manifest entries; ${errors.length} non-2xx`);
  for (const e of errors) console.log(`  ERR ${e}`);
}

async function main(): Promise<void> {
  if (STRICT) return mainStrict();
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`NCBI_API_KEY ${NCBI_API_KEY ? 'set' : 'not set'}; EXA_API_KEY ${EXA_API_KEY ? 'set' : 'not set'}`);
  for (const d of DISEASES) await recordDisease(d);
  if (!EXA_API_KEY) {
    save('exa/README.md',
      '# Exa fixtures pending\n\nExa fixtures are pending an `EXA_API_KEY`. Re-run `node --experimental-strip-types scripts/record-fixtures.ts` with `EXA_API_KEY` set to record ' +
      '`fixtures/api/exa/<slug>/<n>.json` (3 queries per disease, numResults=8, text maxCharacters=2000).\n');
  }
  save('MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${manifest.length} manifest entries; ${errors.length} non-2xx`);
  for (const e of errors) console.log(`  ERR ${e}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
