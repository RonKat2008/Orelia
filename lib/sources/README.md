# Source clients

Server-side typed clients use an injected `Transport`; no model prompts or direct outreach.
`FetchTransport` supports live fetch and timeouts; `FixtureTransport` never accesses the network.
Construct one client per source for a research run so its serial rate limiter applies to all tool calls.
PubMed defaults to 3 requests/second, or 10 with `apiKey`; other remote clients conservatively use 3.
All clients accept an injected `RateLimiter` for a shared quota or fake clock.

```ts
import { FixtureTransport, PubMedClient, aggregateAuthors } from './index';
const transport = new FixtureTransport();
const client = new PubMedClient(transport);
const search = await client.search('epithelioid sarcoma', {
  key: 'pubmed/epithelioid-sarcoma/esearch.json',
});
const result = await client.fetch(search.ids, 'pubmed/epithelioid-sarcoma/efetch.xml');
const authors = aggregateAuthors(result.records, new Date('2026-10-24T00:00:00Z'));
```

Each result returns typed `records` and frozen-contract `Evidence[]`, with wrapper-generated source URLs
and recorded/live fetch timestamps. Evidence has no ID in the frozen contract: the caller assigns IDs
when persisting and uses those IDs for resource references and ranking signals.

- `PubMedClient.search(term, {mesh?, retstart?, retmax?, key?})` returns IDs and numeric count/pagination.
  The caller can advance `retstart` to retrieve more pages; counts on aggregated authors cover only
  fetched journal records, never all search hits. Live queries quote disease names with `[tiab]` and
  optionally add a MeSH clause. Recorded fixtures used broader unquoted queries: explicit fixture keys
  replay those exact historical responses, **not** results from the improved query. Book chapters are
  excluded from journal counts. Authors without affiliations remain usable bibliographic records.
  `aggregateAuthors(records, now)` groups exact bibliographic names, deduplicates PMIDs, and counts
  publication years from `now.year - 5` through `now.year` inclusive ("since 2021" for 2026).
  These groups are not verified clinician identities. Aggregate evidence is available on records
  returned by `fetch`; standalone XML parsing alone supplies no timestamp/provenance.
- `CtgovClient.recruitingStudies(disease, {keys?, pageSize?, maxPages?})` consumes all pages, including
  an empty final page, and throws on repeated tokens or a truncated pagination budget. Keys are ordered
  per-page. Site contacts come from `contactsLocationsModule.locations[].contacts`; central contacts
  and overall officials remain separate. Overall recruiting status does not imply every site recruits.
- `NppesClient.lookup({firstName,lastName,state?,taxonomy?,affiliation?,key?,limit?})` deduplicates NPIs.
  `verified` requires one active individual with exact normalized name, matching state, taxonomy and
  listed organization affiliation, and a response below the actual request cap. NPPES often omits an
  individual clinician's organization; these records remain `ambiguous`. A name-only hit is never
  selected as identity. Registry search can expand names (John → Jack); returned records are preserved
  as candidates. A capped response is ambiguous; an empty 200 response is `not_found`.
- `ExaClient.search(query,{key?,numResults?})` requests contents with search. Only returned page text
  creates excerpt evidence; titles/snippets alone do not. `contents(urls,key?)` permits only URLs
  returned by a prior search on that client and rejects unexpected response URLs. Recorded Exa
  fixtures include fetched text in search, but no separate contents-call fixture was recorded;
  contents requests are tested with an injected transport. Excerpts are raw source text, not validated
  medical guidance or proof of disease fit. The verifier/agent must check relevance and medical advice.
- `loadNciCenters()` reads the local dataset; `matchNciCenters(affiliation,dataset)` returns conservative
  name/token matches and designation evidence from NCI profile URLs. It includes the recorded
  `Clinical Cancer Center` designation and does not assert employment from a fuzzy name match.

Fixture keys are relative to `fixtures/api`, optionally remapped in `new FixtureTransport(root, keys)`.
They must appear in `MANIFEST.json`, stay within that directory, and match the request endpoint/method.
Without a key, replay requires a unique exact recorded GET URL. POST replay always requires a key
because the manifest does not record request bodies. A missing fixture fails closed; there is no live
fallback. HTTP/API errors raise `SourceError`; no error includes request URLs or API keys.

Ranking lives in `lib/ranking/rank.ts`. Candidates carry optional `signals` keyed by
`subtypeExpertise`, `institutionalFit`, `access`, `contactability`, each `{value: 0..1,text,evidenceIds}`.
Default weights are 50/25/15/10. Missing evidence or reason text awards zero points. The caller must
validate that IDs refer to actual evidence. Output retains each candidate with `score`, one-based
`rank`, and `breakdown`; ties use code-unit ascending ID, independent of locale and input order.
Duplicate IDs and invalid weights/signals throw. Scores order resources, never treatment options.
