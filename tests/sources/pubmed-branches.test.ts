import { describe, expect, it, vi } from "vitest";
import { PubMedClient, aggregateAuthors, buildPubmedQuery, parsePubmedXml, type PubmedArticle } from "../../lib/sources/pubmed";
import { RateLimiter, type Transport } from "../../lib/sources/transport";

const NOW = "2026-10-24T04:40:00.000Z";
const immediate = () => new RateLimiter(1000, () => 0, async () => {});
const set = (inner: string) => `<?xml version="1.0"?><PubmedArticleSet>${inner}</PubmedArticleSet>`;
const article = (pmid: string, extra = "", date = "<PubDate><Year>2024</Year></PubDate>") =>
  `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><Journal><JournalIssue>${date}</JournalIssue></Journal><ArticleTitle>Synthetic title ${pmid}</ArticleTitle><AuthorList>${extra}</AuthorList></Article></MedlineCitation></PubmedArticle>`;
const author = (last: string, fore: string, aff = "") => `<Author><LastName>${last}</LastName><ForeName>${fore}</ForeName>${aff ? `<AffiliationInfo><Affiliation>${aff}</Affiliation></AffiliationInfo>` : ""}</Author>`;

describe("buildPubmedQuery", () => {
  it("rejects blank terms", () => {
    expect(() => buildPubmedQuery("  ")).toThrow("Empty disease query");
  });
  it("strips quotes and backslashes and appends MeSH when given", () => {
    expect(buildPubmedQuery('a"b\\c', "Sarcoma")).toBe('"a b c"[tiab] OR "Sarcoma"[MeSH Terms]');
  });
  it("omits the MeSH clause by default", () => {
    expect(buildPubmedQuery("sarcoma")).toBe('"sarcoma"[tiab]');
  });
});

describe("parsePubmedXml", () => {
  it("wraps XML syntax errors", () => {
    expect(() => parsePubmedXml("<a><b></a>")).toThrow("pubmed: Invalid XML response");
  });
  it("surfaces ERROR elements from the service", () => {
    expect(() => parsePubmedXml("<eFetchResult><ERROR>Quota exceeded</ERROR></eFetchResult>")).toThrow("Quota exceeded");
  });
  it("requires a PubmedArticleSet", () => {
    expect(() => parsePubmedXml("<other/>")).toThrow("Missing article set");
  });
  it("returns no articles for an empty set", () => {
    expect(parsePubmedXml("<PubmedArticleSet></PubmedArticleSet>")).toEqual([]);
  });
  it.each(["abc", ""])("rejects invalid PMID %j", pmid => {
    expect(() => parsePubmedXml(set(article(pmid)))).toThrow("Invalid PMID");
  });
  it("parses years from Year, MedlineDate, or reports null", () => {
    const xml = set(
      article("1", "", "<PubDate><Year>2020</Year></PubDate>") +
      article("2", "", "<PubDate><MedlineDate>1998 Dec-1999 Jan</MedlineDate></PubDate>") +
      article("3", "", "<PubDate><MedlineDate>unknown</MedlineDate></PubDate>") +
      article("4", "", "") +
      article("5", "", "<PubDate></PubDate>"));
    expect(parsePubmedXml(xml).map(a => a.year)).toEqual([2020, 1998, null, null, null]);
  });
  it("parses authors with fore name, initials, collective names and affiliations", () => {
    const xml = set(article("7", author("Doe", "Jane", "  Dept of  X,\n Synthetic U ") +
      "<Author><LastName>Roe</LastName><Initials>R</Initials></Author>" +
      "<Author><CollectiveName>Synthetic Consortium</CollectiveName></Author>"));
    const [a] = parsePubmedXml(xml);
    expect(a.sourceUrl).toBe("https://pubmed.ncbi.nlm.nih.gov/7/");
    expect(a.authors[0]).toEqual({ firstName: "Jane", lastName: "Doe", name: "Jane Doe", affiliations: ["Dept of X, Synthetic U"] });
    expect(a.authors[1]).toMatchObject({ firstName: "R", name: "R Roe", affiliations: [] });
    expect(a.authors[2]).toMatchObject({ lastName: "", name: "Synthetic Consortium" });
  });
});

describe("aggregateAuthors", () => {
  const mk = (pmid: string, year: number | null, authors: PubmedArticle["authors"], fetchedAt?: string): PubmedArticle =>
    ({ pmid, title: `T${pmid}`, year, authors, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, fetchedAt });
  const jane = (aff: string[] = []) => ({ name: "Jane Doe", firstName: "Jane", lastName: "Doe", affiliations: aff });
  const now = new Date("2026-10-24T00:00:00Z");

  it("rejects an invalid current date", () => {
    expect(() => aggregateAuthors([], new Date("nope"))).toThrow("Invalid current date");
  });
  it("skips authors without a last name", () => {
    expect(aggregateAuthors([mk("1", 2025, [{ name: "Group", firstName: "", lastName: "", affiliations: [] }])], now)).toEqual([]);
  });
  it("merges identical names, unions sorted affiliations and counts recent papers", () => {
    const out = aggregateAuthors([
      mk("1", 2025, [jane(["Z Univ"])], NOW),
      mk("2", 2010, [jane(["A Univ"])], NOW),
      mk("3", 2031, [jane()], NOW),
      mk("4", null, [jane()], NOW),
    ], now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ paperCount: 4, recentPaperCount: 1, pmids: ["1", "2", "3", "4"], affiliations: ["A Univ", "Z Univ"] });
    expect(out[0].evidence).toHaveLength(4);
    expect(out[0].evidence[0].claim).toContain("listed affiliations: Z Univ");
    expect(out[0].evidence[2].claim).not.toContain("listed affiliations");
  });
  it("counts a PMID once even if an author is listed twice on it", () => {
    const out = aggregateAuthors([mk("1", 2025, [jane(), jane()], NOW)], now);
    expect(out[0].paperCount).toBe(1);
    expect(out[0].evidence).toHaveLength(1);
  });
  it("records no evidence when the article has no fetch timestamp", () => {
    expect(aggregateAuthors([mk("1", 2025, [jane()])], now)[0].evidence).toEqual([]);
  });
  it("keeps distinct authors that share a display name", () => {
    const g = (last: string) => ({ name: "Group", firstName: "", lastName: last, affiliations: [] });
    expect(aggregateAuthors([mk("1", 2025, [g("A"), g("B")])], now)).toHaveLength(2);
  });
  it("sorts distinct authors by display name", () => {
    const zed = { name: "Zed Zee", firstName: "Zed", lastName: "Zee", affiliations: [] };
    const out = aggregateAuthors([mk("1", 2025, [zed, jane()])], now);
    expect(out.map(a => a.name)).toEqual(["Jane Doe", "Zed Zee"]);
  });
});

describe("PubMedClient", () => {
  function client(responses: { body: string; status?: number; requestUrl?: string }[], apiKey?: string) {
    const queue = [...responses];
    const request = vi.fn(async () => ({ fetchedAt: NOW, status: 200, ...queue.shift()! }));
    return { c: new PubMedClient({ request } as Transport, { apiKey, limiter: immediate() }), request };
  }
  const search = (r: unknown) => ({ body: JSON.stringify({ esearchresult: r }) });
  const ok = { count: "2", retstart: "0", retmax: "50", idlist: ["1", "2"] };

  it("searches with default paging and no api key", async () => {
    const { c, request } = client([search(ok)]);
    const res = await c.search("sarcoma");
    expect(res).toEqual({ ids: ["1", "2"], count: 2, retstart: 0, retmax: 50, fetchedAt: NOW });
    const u = new URL((request.mock.calls[0] as unknown as [{ url: string }])[0].url);
    expect(u.searchParams.get("api_key")).toBeNull();
    expect(u.searchParams.get("retstart")).toBe("0");
    expect(u.searchParams.get("retmax")).toBe("50");
  });
  it("passes mesh, paging, api key and fixture key through", async () => {
    const { c, request } = client([search(ok)], "synthetic-key");
    await c.search("sarcoma", { mesh: "Sarcoma", retstart: 10, retmax: 5, key: "fx" });
    const arg = (request.mock.calls[0] as unknown as [{ url: string; key: string }])[0];
    const u = new URL(arg.url);
    expect(u.searchParams.get("api_key")).toBe("synthetic-key");
    expect(u.searchParams.get("term")).toContain("[MeSH Terms]");
    expect([u.searchParams.get("retstart"), u.searchParams.get("retmax"), arg.key]).toEqual(["10", "5", "fx"]);
  });
  it("builds a default limiter when none is supplied", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => ({ ...search(ok), fetchedAt: NOW, status: 200 }));
    const c = new PubMedClient({ request } as Transport);
    const pending = c.search("sarcoma");
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    ["top-level error", { body: JSON.stringify({ error: "bad" }) }],
    ["ERROR in result", search({ ...ok, ERROR: "bad" })],
    ["missing esearchresult", { body: "{}" }],
    ["idlist not an array", search({ ...ok, idlist: "1" })],
    ["non-numeric count", search({ ...ok, count: "x" })],
  ])("rejects invalid search responses: %s", async (_n, resp) => {
    const { c } = client([resp]);
    await expect(c.search("sarcoma")).rejects.toThrow("Invalid search response");
  });
  it("rejects blank search terms", async () => {
    const { c } = client([]);
    await expect(c.search(" ")).rejects.toThrow("Empty disease query");
  });

  it("returns nothing for an empty id list without a request", async () => {
    const { c, request } = client([]);
    expect(await c.fetch([])).toEqual({ records: [], evidence: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects non-numeric ids", async () => {
    const { c, request } = client([]);
    await expect(c.fetch(["1", "x;2"])).rejects.toThrow("Invalid PMID");
    expect(request).not.toHaveBeenCalled();
  });
  it("throws on HTTP errors with a scrubbed endpoint", async () => {
    const { c } = client([{ body: "", status: 500, requestUrl: "https://eutils.ncbi.nlm.nih.gov/x.fcgi?api_key=secret" }]);
    const err = await c.fetch(["1"]).catch((e: Error) => e);
    expect((err as Error).message).toBe("pubmed: HTTP 500 https://eutils.ncbi.nlm.nih.gov/x.fcgi");
  });
  it("uses a placeholder endpoint when the response lacks requestUrl", async () => {
    const { c } = client([{ body: "", status: 502 }]);
    await expect(c.fetch(["1"])).rejects.toThrow("unknown-endpoint");
  });
  it("fetches only requested PMIDs, stamping fetchedAt and building evidence", async () => {
    const xml = set(article("1", author("Doe", "Jane"), "<PubDate></PubDate>") + article("99", author("Roe", "Rick")));
    const { c } = client([{ body: xml }]);
    const res = await c.fetch(["1"], "fx");
    expect(res.records.map(r => r.pmid)).toEqual(["1"]);
    expect(res.records[0].fetchedAt).toBe(NOW);
    expect(res.evidence[0].claim).toBe("Synthetic title 1 (year unknown); authors: Jane Doe");
  });
  it("propagates malformed XML as a SourceError", async () => {
    const { c } = client([{ body: "<PubmedArticleSet><a></PubmedArticleSet>" }]);
    await expect(c.fetch(["1"])).rejects.toThrow("Invalid XML response");
  });
});
