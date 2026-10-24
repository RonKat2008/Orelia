import { describe, expect, it } from "vitest";
import { createLivePorts } from "@/lib/agents/research/live-ports";
import { RateLimiter, type NciDataset, type SourceRequest, type SourceResponse, type Transport } from "@/lib/sources";

const instant = () => new RateLimiter(1000, () => 0, async () => {});
const limiters = { pubmed: instant(), ctgov: instant(), nppes: instant(), exa: instant() };
const FETCHED_AT = "2026-10-24T00:00:00.000Z";
const NOW = () => new Date("2026-10-24T00:00:00Z");

type Handler = (url: URL, request: SourceRequest) => unknown;

/** In-memory transport: routes by hostname/path to a handler and serializes its return value as the body. */
function fakeTransport(handlers: Record<string, Handler>): Transport & { requests: SourceRequest[] } {
  const requests: SourceRequest[] = [];
  return {
    requests,
    async request(request): Promise<SourceResponse> {
      requests.push(request);
      const url = new URL(request.url);
      const handler = handlers[url.hostname + url.pathname] ?? handlers[url.hostname];
      if (!handler) throw new Error(`unexpected request to ${request.url}`);
      const out = handler(url, request);
      return { body: typeof out === "string" ? out : JSON.stringify(out), fetchedAt: FETCHED_AT, status: 200, requestUrl: request.url };
    },
  };
}

const article = (pmid: string, authors: string, pubDate: string) => `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article>
  <Journal><JournalIssue><PubDate>${pubDate}</PubDate></JournalIssue></Journal>
  <ArticleTitle>Synthetic disease paper ${pmid}</ArticleTitle><AuthorList>${authors}</AuthorList></Article></MedlineCitation></PubmedArticle>`;
const author = (fore: string | null, last: string, init: string, affiliation?: string) =>
  `<Author>${fore ? `<ForeName>${fore}</ForeName>` : ""}<LastName>${last}</LastName><Initials>${init}</Initials>${affiliation ? `<AffiliationInfo><Affiliation>${affiliation}</Affiliation></AffiliationInfo>` : ""}</Author>`;

const NO_ENV = {} as { NCBI_API_KEY?: string; EXA_API_KEY?: string };

describe("createLivePorts defaults", () => {
  it("builds ports with default env, transport and clock without touching the network", () => {
    // Act
    const ports = createLivePorts();
    // Assert
    expect(Object.keys(ports).sort()).toEqual(["centers", "ctgov", "exa", "nppes", "pubmed"]);
  });

  it("passes request keys through keyFor but never overrides an explicit client key", async () => {
    // Arrange
    const transport = fakeTransport({ "api.exa.ai": () => ({ results: [] }) });
    const ports = createLivePorts({ transport, env: NO_ENV, limiters, keyFor: () => "derived-key" });
    // Act
    await ports.exa.search({ query: "q" });
    // Assert
    expect(transport.requests[0]?.key).toBe("derived-key");
  });

  it("leaves the key undefined when keyFor returns nothing", async () => {
    const transport = fakeTransport({ "api.exa.ai": () => ({ results: [] }) });
    await createLivePorts({ transport, env: NO_ENV, limiters, keyFor: () => undefined }).exa.search({ query: "q" });
    expect(transport.requests[0]?.key).toBeUndefined();
  });

  it("creates default limiters (keyed and unkeyed PubMed) when none are supplied", () => {
    expect(() => createLivePorts({ transport: fakeTransport({}), env: { NCBI_API_KEY: "k", EXA_API_KEY: "k" } })).not.toThrow();
    expect(() => createLivePorts({ transport: fakeTransport({}), env: NO_ENV })).not.toThrow();
  });
});

describe("live pubmed port", () => {
  const efetchXml = `<?xml version="1.0"?><PubmedArticleSet>${[
    article(
      "1001",
      author("Jordan Quinn", "Testwell", "JQ", "Dept of Pathology, Example Hospital, Phoenix, Arizona.") +
        author("J", "Initialsonly", "J", "Somewhere, Utah.") +
        author("Riley", "Norolefirst", "R") +
        author("Sam", "Lastseen", "S", "Example Clinic, Elsewhere"),
      "<Year>2025</Year>",
    ),
    article("1002", author("Jordan Quinn", "Testwell", "JQ", "Example Hospital, Phoenix, Arizona.") + author("Riley", "Norolefirst", "R"), "<MedlineDate>2019 Jan-Feb</MedlineDate>"),
    `<PubmedArticle><MedlineCitation><PMID>1003</PMID><Article><ArticleTitle>No date paper</ArticleTitle><AuthorList>${author("Riley", "Norolefirst", "R")}</AuthorList></Article></MedlineCitation></PubmedArticle>`,
  ].join("")}</PubmedArticleSet>`;

  const transport = () =>
    fakeTransport({
      "eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi": () => ({ esearchresult: { count: "3", retstart: "0", retmax: "50", idlist: ["1001", "1002", "1003"] } }),
      "eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi": () => efetchXml,
    });

  it("skips initials-only names, keeps first-name fields, and sorts by paper count then recency then name", async () => {
    // Arrange
    const ports = createLivePorts({ transport: transport(), env: NO_ENV, now: NOW, limiters });
    // Act
    const hits = await ports.pubmed.searchAuthors({ disease: "synthetic disease" });
    // Assert
    expect(hits.map((h) => h.name)).toEqual(["Riley Norolefirst", "Jordan Testwell", "Sam Lastseen"]);
    expect(hits.some((h) => h.lastName === "Initialsonly")).toBe(false);
    const riley = hits[0]!;
    expect(riley.paperCount).toBe(3);
    expect(riley.affiliation).toBeUndefined();
    expect(riley.state).toBeUndefined();
    expect(riley.middleName).toBeUndefined();
    // paper 1003 has no publication date, so no year key is emitted for it
    expect(riley.papers.find((p) => p.pmid === "1003")).not.toHaveProperty("year");
  });

  it("derives state and middle name from affiliations and counts recent papers", async () => {
    // Arrange
    const ports = createLivePorts({ transport: transport(), env: NO_ENV, now: NOW, limiters });
    // Act
    const hits = await ports.pubmed.searchAuthors({ disease: "synthetic disease" });
    // Assert
    const jordan = hits.find((h) => h.lastName === "Testwell")!;
    expect(jordan).toMatchObject({ firstName: "Jordan", middleName: "Quinn", state: "AZ", paperCount: 2, recentPaperCount: 1 });
    expect(jordan.affiliation).toContain("Phoenix");
    expect(hits.find((h) => h.lastName === "Lastseen")?.state).toBeUndefined();
  });

  it("carries each author's affiliation on each specific paper", async () => {
    const ports = createLivePorts({ transport: transport(), env: NO_ENV, now: NOW, limiters });
    const jordan = (await ports.pubmed.searchAuthors({ disease: "synthetic disease" })).find((h) => h.lastName === "Testwell")!;
    expect(jordan.papers.find((p) => p.pmid === "1001")?.affiliation).toBe("Dept of Pathology, Example Hospital, Phoenix, Arizona.");
    expect(jordan.papers.find((p) => p.pmid === "1002")?.affiliation).toBe("Example Hospital, Phoenix, Arizona.");
    const riley = (await ports.pubmed.searchAuthors({ disease: "synthetic disease" })).find((h) => h.lastName === "Norolefirst")!;
    expect(riley.papers.every((p) => !("affiliation" in p))).toBe(true);
  });

  it("honours the limit", async () => {
    const ports = createLivePorts({ transport: transport(), env: NO_ENV, now: NOW, limiters });
    expect(await ports.pubmed.searchAuthors({ disease: "synthetic disease", limit: 1 })).toHaveLength(1);
  });
});

describe("live nppes port", () => {
  const provider = (over: Record<string, unknown>) => ({
    number: "1234567893",
    enumeration_type: "NPI-1",
    basic: { first_name: "Jordan", last_name: "Testwell", credential: "MD", status: "A" },
    addresses: [
      { address_purpose: "MAILING", city: "MAILCITY", state: "NM" },
      { address_purpose: "LOCATION", city: "PHOENIX", state: "AZ" },
    ],
    taxonomies: [{ desc: "Internal Medicine" }, { desc: "Pathology", primary: true }],
    ...over,
  });

  const lookup = (results: unknown[], input: { state?: string } = {}, count = results.length) => {
    const transport = fakeTransport({ "npiregistry.cms.hhs.gov": () => ({ result_count: count, results }) });
    const ports = createLivePorts({ transport, env: NO_ENV, limiters });
    return ports.nppes.lookup({ firstName: "Jordan", lastName: "Testwell", ...input });
  };

  it("prefers the LOCATION address and primary taxonomy, and adds state only when given", async () => {
    // Act
    const withState = await lookup([provider({})], { state: "AZ" });
    const withoutState = await lookup([provider({})]);
    // Assert
    expect(withState.providers[0]).toMatchObject({ npi: "1234567893", city: "PHOENIX", state: "AZ", taxonomy: "Pathology", credential: "MD" });
    expect(withState.searchUrl).toContain("state=AZ");
    expect(withoutState.searchUrl).not.toContain("state=");
    expect(withState.truncated).toBe(false);
  });

  it("falls back to the first address and first taxonomy when no LOCATION or primary exists", async () => {
    // Act
    const result = await lookup([
      provider({ addresses: [{ address_purpose: "MAILING", city: "ONLY", state: "NM" }], taxonomies: [{ desc: "First Taxonomy" }, { desc: "Second" }] }),
    ]);
    // Assert
    expect(result.providers[0]).toMatchObject({ city: "ONLY", state: "NM", taxonomy: "First Taxonomy" });
  });

  it("tolerates providers with no addresses, taxonomies or names", async () => {
    // Act
    const result = await lookup([provider({ addresses: undefined, taxonomies: undefined, basic: { status: "A" } })]);
    // Assert
    expect(result.providers[0]).toMatchObject({ firstName: "", lastName: "" });
    expect(result.providers[0]?.city).toBeUndefined();
    expect(result.providers[0]?.taxonomy).toBeUndefined();
  });

  it("filters organizations and inactive providers", async () => {
    // Act
    const result = await lookup([
      provider({}),
      provider({ number: "1000000004", enumeration_type: "NPI-2" }),
      provider({ number: "1000000012", basic: { first_name: "Jordan", last_name: "Testwell", status: "I" } }),
    ]);
    // Assert
    expect(result.providers.map((p) => p.npi)).toEqual(["1234567893"]);
  });

  it("flags truncation when the registry returned the full result limit", async () => {
    // Arrange: 200 distinct NPIs
    const rows = Array.from({ length: 200 }, (_v, i) => provider({ number: String(1000000000 + i) }));
    // Act
    const result = await lookup(rows);
    // Assert
    expect(result.truncated).toBe(true);
  });
});

describe("live exa port", () => {
  it("falls back to the URL as the title when the page has none and passes numResults", async () => {
    // Arrange
    const transport = fakeTransport({
      "api.exa.ai": () => ({ results: [{ url: "https://example.org/a", text: "body" }, { url: "https://example.org/b", title: "B", text: undefined }] }),
    });
    const ports = createLivePorts({ transport, env: { EXA_API_KEY: "k" }, limiters });
    // Act
    const results = await ports.exa.search({ query: "q", numResults: 2 });
    // Assert
    expect(results).toEqual([
      { url: "https://example.org/a", title: "https://example.org/a", text: "body" },
      { url: "https://example.org/b", title: "B", text: undefined },
    ]);
    expect((transport.requests[0]?.body as { numResults: number }).numResults).toBe(2);
    expect(transport.requests[0]?.headers?.["x-api-key"]).toBe("k");
  });
});

describe("live ctgov port", () => {
  it("maps a minimal study with no optional sections to empty collections", async () => {
    // Arrange
    const study = {
      protocolSection: {
        identificationModule: { nctId: "NCT00000001", briefTitle: "Synthetic trial" },
        statusModule: { overallStatus: "RECRUITING" },
        contactsLocationsModule: { overallOfficials: [{ name: "Dr. Named" }, {}], centralContacts: [{ email: "ctr@example.org" }], locations: [{ facility: "Site", state: "AZ" }] },
      },
    };
    const transport = fakeTransport({ "clinicaltrials.gov": () => ({ studies: [study] }) });
    const ports = createLivePorts({ transport, env: NO_ENV, limiters });
    // Act
    const [trial] = await ports.ctgov.recruitingStudies({ condition: "synthetic" });
    // Assert
    expect(trial).toMatchObject({
      nctId: "NCT00000001",
      investigators: ["Dr. Named"],
      hasContact: true,
      centralContacts: [{ phone: undefined, email: "ctr@example.org" }],
      conditions: [],
      stdAges: [],
    });
    expect(trial?.sites).toEqual([{ facility: "Site", city: undefined, state: "AZ", country: undefined, status: undefined }]);
  });

  it("reports hasContact false when the registry lists no central contacts", async () => {
    const study = { protocolSection: { identificationModule: { nctId: "NCT00000002" }, statusModule: { overallStatus: "RECRUITING" } } };
    const transport = fakeTransport({ "clinicaltrials.gov": () => ({ studies: [study] }) });
    const [trial] = await createLivePorts({ transport, env: NO_ENV, limiters }).ctgov.recruitingStudies({ condition: "synthetic" });
    expect(trial).toMatchObject({ hasContact: false, title: "NCT00000002", investigators: [] });
  });
});

describe("live centers port", () => {
  const center = (name: string, state: string, designation = "Comprehensive Cancer Center") => ({ name, city: "X", state, designation, url: `https://www.cancer.gov/c/${name}` });
  const dataset: NciDataset = {
    source_url: "https://example.org",
    generated_at: FETCHED_AT,
    centers: [center("B Center", "AZ"), center("A Center", "AZ"), center("Clinical Only", "AZ", "Cancer Center"), center("Far Center", "NY"), center("Unknown Place", "ZZ")],
  };
  const ports = () => createLivePorts({ transport: fakeTransport({}), env: NO_ENV, nciDataset: dataset });

  it("sorts same-state centers by name and excludes non-comprehensive designations", async () => {
    const out = await ports().centers.match({ diseaseName: "sarcoma", homeState: "AZ", travelLimitMiles: 100 });
    expect(out.map((c) => c.name)).toEqual(["A Center", "B Center"]);
  });

  it("includes every known-distance center when no travel limit is given, but never unknown states", async () => {
    const out = await ports().centers.match({ diseaseName: "sarcoma", homeState: "AZ" });
    expect(out.map((c) => c.name)).toEqual(["A Center", "B Center", "Far Center"]);
  });

  it("returns nothing for non-cancer diseases or an unknown home state", async () => {
    expect(await ports().centers.match({ diseaseName: "lupus", homeState: "AZ" })).toEqual([]);
    expect(await ports().centers.match({ diseaseName: "sarcoma", homeState: "ZZ", travelLimitMiles: 50 })).toEqual([]);
  });

  it("caps results at eight centers", async () => {
    const many: NciDataset = { ...dataset, centers: Array.from({ length: 12 }, (_v, i) => center(`Center ${String(i).padStart(2, "0")}`, "AZ")) };
    const out = await createLivePorts({ transport: fakeTransport({}), env: NO_ENV, nciDataset: many }).centers.match({ diseaseName: "cancer", homeState: "AZ" });
    expect(out).toHaveLength(8);
  });

  it("falls back to the bundled NCI dataset when none is injected", async () => {
    const out = await createLivePorts({ transport: fakeTransport({}), env: NO_ENV }).centers.match({ diseaseName: "sarcoma", homeState: "AZ", travelLimitMiles: 50 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.state === "AZ")).toBe(true);
  });
});
