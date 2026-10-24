/**
 * Live SourcePorts: adapts the typed clients in lib/sources (FetchTransport + serial RateLimiter) to the port
 * interfaces the research agents depend on. Create ONE set per research run so each client's rate limiter and
 * Exa's returned-URL allowlist apply to every tool call in that run. Tests inject a FixtureTransport.
 */
import { env as defaultEnv, type Env } from "@/lib/env";
import {
  CtgovClient,
  ExaClient,
  FetchTransport,
  NppesClient,
  PubMedClient,
  RateLimiter,
  aggregateAuthors,
  type NciDataset,
  type PubmedArticle,
  type Transport,
} from "@/lib/sources";
import nciCentersData from "../../../data/nci-centers.json";
import { CANCER_WORDS, stateDistanceMiles, stateFromAffiliation } from "./geo";
import type {
  CentersPort,
  CtgovPort,
  ExaPort,
  NciCenter,
  NppesPort,
  PubmedAuthorHit,
  PubmedPort,
  SourcePorts,
} from "./source-ports";

const PUBMED_RETMAX = 50;
const DEFAULT_AUTHOR_LIMIT = 6;
const DEFAULT_RATE_PER_SECOND = 3;
const PUBMED_KEYED_RATE_PER_SECOND = 10;
const MAX_CENTERS = 8;
const NPPES_RESULT_LIMIT = 200;

export interface LivePortsOptions {
  transport?: Transport;
  env?: Pick<Env, "NCBI_API_KEY" | "EXA_API_KEY">;
  /** Reference date for "last 5 years" paper counts. */
  now?: () => Date;
  /** Shared or fake-clock limiters; each defaults to the source's conservative rate. */
  limiters?: Partial<Record<"pubmed" | "ctgov" | "nppes" | "exa", RateLimiter>>;
  /** Pre-loaded NCI dataset (tests); otherwise data/nci-centers.json is read lazily. */
  nciDataset?: NciDataset;
  /** Fixture keys per request (tests only): lets a FixtureTransport replay differently-shaped live queries. */
  keyFor?: (request: { url: string; method?: string; body?: unknown }) => string | undefined;
}

const firstToken = (s: string): string => (s.trim().split(/\s+/)[0] ?? "").replace(/\./g, "");

function toAuthorHits(
  articles: readonly PubmedArticle[],
  now: Date,
  limit: number,
): PubmedAuthorHit[] {
  const byPmid = new Map(articles.map((a) => [a.pmid, a]));
  return aggregateAuthors([...articles], now)
    .flatMap((a) => {
      const firstName = firstToken(a.firstName);
      // Initials-only names cannot be looked up reliably in NPPES; skip them like the fixture port does.
      if (firstName.length < 2 || !a.lastName) return [];
      const affiliation = a.affiliations[0];
      const state = a.affiliations.map(stateFromAffiliation).find((s) => s !== undefined);
      const hit: PubmedAuthorHit = {
        name: `${firstName} ${a.lastName}`,
        firstName,
        middleName: a.firstName.trim().split(/\s+/).slice(1).join(" ") || undefined,
        affiliations: a.affiliations,
        lastName: a.lastName,
        ...(affiliation ? { affiliation } : {}),
        ...(state ? { state } : {}),
        paperCount: a.paperCount,
        recentPaperCount: a.recentPaperCount,
        papers: a.pmids.flatMap((pmid) => {
          const article = byPmid.get(pmid);
          return article ? [{ pmid, title: article.title, ...(article.year ? { year: article.year } : {}) }] : [];
        }),
      };
      return [hit];
    })
    .sort(
      (a, b) =>
        b.paperCount - a.paperCount || b.recentPaperCount - a.recentPaperCount || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

export function createLivePorts(options: LivePortsOptions = {}): SourcePorts {
  const env = options.env ?? defaultEnv;
  const transport = options.transport ?? new FetchTransport();
  const now = options.now ?? (() => new Date());
  const keyed: Transport = options.keyFor
    ? { request: (r) => transport.request({ ...r, key: r.key ?? options.keyFor?.(r) }) }
    : transport;
  const limiter = (name: "pubmed" | "ctgov" | "nppes" | "exa", rate: number): RateLimiter =>
    options.limiters?.[name] ?? new RateLimiter(rate);

  const pubmedClient = new PubMedClient(keyed, {
    apiKey: env.NCBI_API_KEY,
    limiter: limiter("pubmed", env.NCBI_API_KEY ? PUBMED_KEYED_RATE_PER_SECOND : DEFAULT_RATE_PER_SECOND),
  });
  const ctgovClient = new CtgovClient(keyed, limiter("ctgov", DEFAULT_RATE_PER_SECOND));
  const nppesClient = new NppesClient(keyed, limiter("nppes", DEFAULT_RATE_PER_SECOND));
  const exaClient = new ExaClient(keyed, env.EXA_API_KEY, limiter("exa", DEFAULT_RATE_PER_SECOND));

  const pubmed: PubmedPort = {
    async searchAuthors({ disease, limit = DEFAULT_AUTHOR_LIMIT }) {
      const search = await pubmedClient.search(disease, { retmax: PUBMED_RETMAX });
      const fetched = await pubmedClient.fetch(search.ids);
      return toAuthorHits(fetched.records, now(), limit);
    },
  };

  const ctgov: CtgovPort = {
    async recruitingStudies({ condition }) {
      const { records } = await ctgovClient.recruitingStudies(condition);
      return records.map((t) => ({
        nctId: t.nctId,
        title: t.title,
        status: t.status,
        phases: t.phases,
        sponsor: t.sponsor,
        sites: t.sites.map((s) => ({
          facility: s.facility,
          city: s.city,
          state: s.state,
          country: s.country,
          status: s.status,
        })),
        conditions: t.conditions,
        keywords: t.keywords,
        meshTerms: t.meshTerms,
        stdAges: t.stdAges,
        minimumAge: t.minimumAge,
        investigators: t.investigators.flatMap((o) => (o.name ? [o.name] : [])),
        hasContact: t.contacts.length > 0,
      }));
    },
  };

  const nppes: NppesPort = {
    async lookup({ firstName, lastName, state }) {
      const result = await nppesClient.lookup({ firstName, lastName, state, limit: NPPES_RESULT_LIMIT });
      const url = new URL("https://npiregistry.cms.hhs.gov/api/");
      for (const [k, v] of Object.entries({
        version: "2.1",
        first_name: firstName,
        last_name: lastName,
        ...(state ? { state } : {}),
        limit: String(NPPES_RESULT_LIMIT),
      })) {
        url.searchParams.set(k, v);
      }
      return {
        searchUrl: url.href,
        truncated: result.records.length >= NPPES_RESULT_LIMIT,
        providers: result.records
          .filter((r) => r.enumeration_type !== "NPI-2" && r.basic.status !== "I")
          .map((r) => {
            const location = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
            const taxonomy = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0];
            return {
              npi: r.number,
              raw: r,
              firstName: r.basic.first_name ?? "",
              lastName: r.basic.last_name ?? "",
              credential: r.basic.credential,
              taxonomy: taxonomy?.desc,
              city: location?.city,
              state: location?.state,
            };
          }),
      };
    },
  };

  const exa: ExaPort = {
    async search({ query, numResults }) {
      const { records } = await exaClient.search(query, { numResults });
      return records.map((r) => ({ url: r.url, title: r.title ?? r.url, text: r.text }));
    },
  };

  // Statically imported so the bundler includes it (no dynamic filesystem tracing).
  const dataset: NciDataset = options.nciDataset ?? (nciCentersData as NciDataset);
  const centers: CentersPort = {
    async match({ diseaseName, homeState, travelLimitMiles }) {
      // The NCI list covers cancer centers only; other diseases get nothing from this port.
      if (!CANCER_WORDS.test(diseaseName) || !homeState) return [];
      return dataset.centers
        .filter((c) => c.designation === "Comprehensive Cancer Center")
        .flatMap((c) => {
          const miles = stateDistanceMiles(homeState, c.state);
          const inRange = miles !== undefined && (miles === 0 || travelLimitMiles === undefined || miles <= travelLimitMiles);
          return inRange ? [{ center: c as NciCenter, miles }] : [];
        })
        .sort((a, b) => a.miles - b.miles || a.center.name.localeCompare(b.center.name))
        .slice(0, MAX_CENTERS)
        .map((x) => x.center);
    },
  };

  return { pubmed, ctgov, nppes, exa, centers };
}
