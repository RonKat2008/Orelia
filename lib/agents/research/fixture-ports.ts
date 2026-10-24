import type { NppesProvider as RawNppesProvider } from "@/lib/sources/nppes";
/**
 * Offline SourcePorts backed by the recorded API responses in fixtures/api and data/nci-centers.json. Used by
 * tests and scripts/build-llm-fixtures.ts until the real lib/sources wrappers are wired in. Node-only (fs).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CANCER_WORDS, stateFromAffiliation } from "./geo";
import { caseSlug } from "./shared";
import type {
  CentersPort,
  CtgovPort,
  CtgovStudy,
  ExaPort,
  NciCenter,
  NppesPort,
  PubmedAuthorHit,
  PubmedPort,
  SourcePorts,
} from "./source-ports";

const RECENT_YEARS = 5;
/** Fixture-only stand-in for distance filtering (the real CentersPort computes it). */
const NEARBY_STATES: Record<string, string[]> = { AZ: ["AZ", "NM", "UT", "CO", "CA"] };

interface Options {
  root?: string;
  /** Year used for "recent" paper counts (fixed so recorded outputs are stable). */
  asOfYear?: number;
  /** Use the strict PubMed/NPPES recordings when present (default). false pins the original 50-paper sample. */
  strict?: boolean;
}

const slugPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .trim();
}

class FixtureReader {
  readonly root: string;
  constructor(root: string) {
    this.root = path.join(root, "fixtures", "api");
  }
  json<T>(rel: string): T {
    return JSON.parse(readFileSync(path.join(this.root, rel), "utf8")) as T;
  }
  text(rel: string): string {
    return readFileSync(path.join(this.root, rel), "utf8");
  }
  exists(rel: string): boolean {
    return existsSync(path.join(this.root, rel));
  }
  manifestUrl(rel: string): string {
    const manifest = this.json<Array<{ file: string; url: string }>>("MANIFEST.json");
    return manifest.find((m) => m.file === rel)?.url ?? `fixture://${rel}`;
  }
}

/** Strict-mode recording (strict-<last>-<first>.json) wins over the original small-sample recording. */
function nppesFile(slug: string, firstName: string, lastName: string, exists?: (rel: string) => boolean): string {
  const base = `${slugPart(lastName)}-${slugPart(firstName)}.json`;
  const strict = `nppes/${slug}/strict-${base}`;
  return exists?.(strict) ? strict : `nppes/${slug}/${base}`;
}

function parseArticles(xml: string): Array<{
  pmid: string;
  title: string;
  year?: number;
  authors: Array<{ first: string; last: string; middleName?: string; affiliation?: string }>;
}> {
  const blocks = xml.split(/<(?=PubmedArticle>|PubmedBookArticle>)/).slice(1);
  return blocks.flatMap((block) => {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(block)?.[1];
    const title = /<(?:ArticleTitle|BookTitle)[^>]*>([\s\S]*?)<\/(?:ArticleTitle|BookTitle)>/.exec(block)?.[1];
    if (!pmid || !title) return [];
    const articleTitle = /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/.exec(block)?.[1] ?? title;
    const year = /<PubDate>\s*<Year>(\d{4})<\/Year>/.exec(block)?.[1];
    const authors = [...block.matchAll(/<AuthorList(?![^>]*editors)[^>]*>([\s\S]*?)<\/AuthorList>/g)]
      .flatMap((list) => [...(list[1] ?? "").matchAll(/<Author [^>]*>([\s\S]*?)<\/Author>/g)])
      .flatMap((a) => {
        const body = a[1] ?? "";
        const last = /<LastName>([\s\S]*?)<\/LastName>/.exec(body)?.[1];
        const fore = /<ForeName>([\s\S]*?)<\/ForeName>/.exec(body)?.[1];
        const affiliation = /<Affiliation>([\s\S]*?)<\/Affiliation>/.exec(body)?.[1];
        const first = fore ? decode(fore).split(/\s+/)[0]?.replace(/\./g, "") : undefined;
        if (!last || !first || first.length < 2) return [];
        return [{ first, middleName: fore ? decode(fore).split(/\s+/).slice(1).join(" ") : undefined, last: decode(last), affiliation: affiliation ? decode(affiliation) : undefined }];
      });
    return [{ pmid, title: decode(articleTitle), year: year ? Number(year) : undefined, authors }];
  });
}

export function createFixturePorts(options: Options = {}): SourcePorts {
  const root = options.root ?? process.cwd();
  const asOfYear = options.asOfYear ?? new Date().getFullYear();
  const reader = new FixtureReader(root);
  const strictMode = options.strict ?? true;

  const nppesPath = (slug: string, first: string, last: string): string =>
    nppesFile(slug, first, last, (r) => strictMode && reader.exists(r));

  /** Strict recording (efetch-strict-<n>.xml, 100 papers each) when present, else the original efetch.xml. */
  const pubmedXmlFiles = (slug: string): string[] => {
    const strict: string[] = [];
    while (strictMode && reader.exists(`pubmed/${slug}/efetch-strict-${strict.length + 1}.xml`)) {
      strict.push(`pubmed/${slug}/efetch-strict-${strict.length + 1}.xml`);
    }
    return strict.length > 0 ? strict : [`pubmed/${slug}/efetch.xml`];
  };

  const pubmed: PubmedPort = {
    async searchAuthors({ disease, limit = 6 }) {
      const slug = caseSlug({ diseaseName: disease });
      const articles = pubmedXmlFiles(slug).flatMap((f) => parseArticles(reader.text(f)));
      const byAuthor = new Map<string, PubmedAuthorHit>();
      for (const article of articles) {
        for (const a of article.authors) {
          // Fixture mode only offers authors that have a recorded NPPES response, so identity can run offline.
          if (!reader.exists(nppesPath(slug, a.first, a.last))) continue;
          const key = `${a.first} ${a.last}`.toLowerCase();
          const hit: PubmedAuthorHit = byAuthor.get(key) ?? {
            name: `${a.first} ${a.last}`,
            firstName: a.first,
            middleName: a.middleName,
            lastName: a.last,
            paperCount: 0,
            recentPaperCount: 0,
            papers: [],
          };
          if (hit.papers.some((p) => p.pmid === article.pmid)) continue;
          const affiliation = hit.affiliation ?? a.affiliation;
          const state = hit.state ?? (a.affiliation ? stateFromAffiliation(a.affiliation) : undefined);
          byAuthor.set(key, {
            ...hit,
            affiliation,
            state,
            paperCount: hit.paperCount + 1,
            recentPaperCount:
              hit.recentPaperCount + (article.year && article.year >= asOfYear - RECENT_YEARS ? 1 : 0),
            papers: [...hit.papers, { pmid: article.pmid, title: article.title, year: article.year }],
          });
        }
      }
      return [...byAuthor.values()]
        .sort((a, b) => b.paperCount - a.paperCount || b.recentPaperCount - a.recentPaperCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
  };

  const ctgov: CtgovPort = {
    async recruitingStudies({ condition }) {
      const slug = caseSlug({ diseaseName: condition });
      const studies = ["studies.json", "studies-page2.json"]
        .filter((f) => reader.exists(`ctgov/${slug}/${f}`))
        .flatMap((f) => reader.json<{ studies: Array<Record<string, any>> }>(`ctgov/${slug}/${f}`).studies); // eslint-disable-line @typescript-eslint/no-explicit-any
      return studies.map((s): CtgovStudy => {
        const p = s.protocolSection;
        return {
          nctId: p.identificationModule.nctId,
          title: p.identificationModule.briefTitle,
          status: p.statusModule.overallStatus,
          phases: p.designModule?.phases,
          sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
          sites: (p.contactsLocationsModule?.locations ?? []).map(
            (l: { facility?: string; city?: string; state?: string; country?: string; status?: string }) => ({
              facility: l.facility,
              city: l.city,
              state: l.state,
              country: l.country,
              status: l.status,
            }),
          ),
          conditions: p.conditionsModule?.conditions ?? [],
          keywords: p.conditionsModule?.keywords ?? [],
          meshTerms: (s.derivedSection?.conditionBrowseModule?.meshes ?? []).map((m: { term: string }) => m.term),
          stdAges: p.eligibilityModule?.stdAges ?? [],
          minimumAge: p.eligibilityModule?.minimumAge,
          maximumAge: p.eligibilityModule?.maximumAge,
          investigators: (p.contactsLocationsModule?.overallOfficials ?? []).flatMap((o: { name?: string }) => (o.name ? [o.name] : [])),
          hasContact: (p.contactsLocationsModule?.centralContacts ?? []).length > 0,
          centralContacts: (p.contactsLocationsModule?.centralContacts ?? []).map((c: { phone?: string; email?: string }) => ({ phone: c.phone, email: c.email })),
        };
      });
    },
  };

  const nppes: NppesPort = {
    async lookup({ firstName, lastName }) {
      // The recorder keyed NPPES files by "<last>-<first>"; find the case folder that has this person.
      const slug = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"].find((s) =>
        reader.exists(nppesPath(s, firstName, lastName)),
      );
      if (!slug) throw new Error(`No NPPES fixture recorded for ${firstName} ${lastName}`);
      const rel = nppesPath(slug, firstName, lastName);
      const body = reader.json<{ result_count: number; results: RawNppesProvider[] }>(rel);
      return {
        searchUrl: reader.manifestUrl(rel),
        truncated: body.result_count >= Number(new URL(reader.manifestUrl(rel)).searchParams.get("limit") ?? 10),
        providers: body.results.map((r) => {
          const location = r.addresses?.find((a) => a.address_purpose === "LOCATION");
          return {
            npi: String(r.number),
            raw: { ...r, number: String(r.number) },
            firstName: r.basic.first_name ?? "",
            lastName: r.basic.last_name ?? "",
            credential: r.basic.credential,
            taxonomy: (r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0])?.desc,
            city: location?.city,
            state: location?.state,
          };
        }),
      };
    },
  };

  const exa: ExaPort = {
    async search({ query }) {
      // The recorder ran three queries per disease: 1 advocacy, 2 financial/travel aid, 3 centers.
      const n = /advoca|support group|foundation/i.test(query) ? 1 : /financ|copay|grant|lodging|assistance/i.test(query) ? 2 : 3;
      const slug = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"].find((s) =>
        query.toLowerCase().includes(s === "vascular-eds" ? "ehlers" : s === "igg4-related-disease" ? "igg4" : "epithelioid"),
      );
      if (!slug) throw new Error(`No Exa fixture for query: ${query}`);
      return reader
        .json<{ results: Array<{ url: string; title: string; text?: string }> }>(`exa/${slug}/${n}.json`)
        .results.map((r) => ({ url: r.url, title: r.title, text: r.text }));
    },
  };

  const centers: CentersPort = {
    async match({ diseaseName, homeState }) {
      if (!CANCER_WORDS.test(diseaseName)) return [];
      const file = JSON.parse(readFileSync(path.join(root, "data", "nci-centers.json"), "utf8")) as {
        centers: NciCenter[];
      };
      const states = homeState ? (NEARBY_STATES[homeState] ?? [homeState]) : [];
      return file.centers
        .filter((c) => c.designation === "Comprehensive Cancer Center" && states.includes(c.state))
        .sort((a, b) => states.indexOf(a.state) - states.indexOf(b.state) || a.name.localeCompare(b.name))
        .slice(0, 8);
    },
  };

  return { pubmed, ctgov, nppes, exa, centers };
}
