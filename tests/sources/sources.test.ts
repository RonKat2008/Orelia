import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { FixtureTransport, FetchTransport, RateLimiter, SourceError, type Transport, type SourceRequest } from "../../lib/sources/transport";
import { PubMedClient, aggregateAuthors, buildPubmedQuery, parsePubmedXml } from "../../lib/sources/pubmed";
import { CtgovClient } from "../../lib/sources/ctgov";
import { NppesClient } from "../../lib/sources/nppes";
import { ExaClient } from "../../lib/sources/exa";
import { loadNciCenters, matchNciCenters } from "../../lib/sources/nci-centers";
import { evidenceSchema } from "../../lib/contracts/evidence";
const now = "2026-10-24T04:40:00.000Z";
const immediate = () => new RateLimiter(1000, () => 0, async () => {});
const fixture = new FixtureTransport();
function mock(body: unknown, status = 200): Transport {
  return { request: vi.fn(async () => ({body: typeof body === "string" ? body : JSON.stringify(body), status, fetchedAt: now})) };
}
afterEach(() => vi.useRealTimers());

describe("transport and rate limit", () => {
  it("replays exact recorded provenance and fails closed on unknown or unsafe keys", async () => {
    const r = await fixture.request({url:"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",key:"pubmed/epithelioid-sarcoma/esearch.json"});
    expect(r.fetchedAt).toMatch(/^2026-/);
    await expect(fixture.request({url:"https://not-recorded.example"})).rejects.toThrow("No recorded");
    await expect(fixture.request({url:"unused",key:"../secret"})).rejects.toThrow("Invalid fixture path");
    await expect(fixture.request({url:"https://api.exa.ai/search",method:"POST"})).rejects.toThrow("explicit fixture key");
  });
  it.each([3,10])("spaces concurrent requests at %s/s", async rate => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const limiter = new RateLimiter(rate);
    const starts: number[] = [];
    const calls = Array.from({length:4}, () => limiter.run(async () => {starts.push(Date.now());}));
    await vi.runAllTimersAsync(); await Promise.all(calls);
    expect(starts).toEqual([0,1,2,3].map(i => i*Math.ceil(1000/rate)));
  });
  it("recovers after rejection", async () => {
    const limiter = immediate();
    await expect(limiter.run(async () => {throw new Error("fail");})).rejects.toThrow("fail");
    expect(await limiter.run(async () => 4)).toBe(4);
  });
  it("live transport serializes JSON and exposes HTTP failures without secrets", async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}',{status:200}));
    const live = new FetchTransport(fetcher as typeof fetch, () => new Date(now));
    expect((await live.request({url:"https://api.exa.ai/search",method:"POST",body:{query:"test"}})).fetchedAt).toBe(now);
    expect(fetcher.mock.calls[0]).toBeDefined();
    const sleeps: number[] = [];
    const failing = new FetchTransport(
      vi.fn(async () => new Response(JSON.stringify({ error: "API rate limit exceeded", "api-key": "203.0.113.4" }), { status: 429 })) as typeof fetch,
      () => new Date(now),
      async (ms) => { sleeps.push(ms); },
    );
    await expect(failing.request({ url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=secret" })).rejects.toThrow(/429 https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esearch\.fcgi: API rate limit exceeded/);
    await expect(failing.request({ url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=secret" })).rejects.toThrow(/^(?!.*secret)(?!.*203\.0\.113\.4)/);
    expect(sleeps.slice(0, 3)).toEqual([1000, 2000, 4000]);
    const retry = vi.fn()
      .mockResolvedValueOnce(new Response("wait", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const slept: number[] = [];
    const recovered = new FetchTransport(retry as typeof fetch, () => new Date(now), async (ms) => { slept.push(ms); });
    expect((await recovered.request({ url: "https://clinicaltrials.gov/api/v2/studies?query.cond=x" })).status).toBe(200);
    expect(slept).toEqual([2000]);
    expect(retry).toHaveBeenCalledTimes(2);
  });
});

describe("PubMed", () => {
  it.each(["epithelioid-sarcoma","vascular-eds","igg4-related-disease"])("parses recorded search and journal authors for %s", async disease => {
    const client = new PubMedClient(fixture,{limiter:immediate()});
    const search = await client.search(disease,{key:`pubmed/${disease}/esearch.json`});
    expect(search.count).toBeGreaterThan(0);
    const result = await client.fetch(search.ids,`pubmed/${disease}/efetch.xml`);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.evidence.every(e => evidenceSchema.safeParse(e).success)).toBe(true);
    const authors = aggregateAuthors(result.records,new Date(now));
    expect(authors.length).toBeGreaterThan(0);
    expect(authors.some(a => a.affiliations.length > 0)).toBe(true);
    expect(authors.every(a => a.recentPaperCount <= a.paperCount && a.evidence.length === a.paperCount)).toBe(true);
  });
  it("quotes terms, forwards pagination, and selects keyed rate", async () => {
    const t = mock({esearchresult:{count:"100",retstart:"50",retmax:"50",idlist:[]}});
    const client = new PubMedClient(t,{apiKey:"test",limiter:immediate()});
    expect(buildPubmedQuery("rare disease","D123")).toBe('"rare disease"[tiab] OR "D123"[MeSH Terms]');
    expect((await client.search("rare disease",{retstart:50})).retstart).toBe(50);
    const req = vi.mocked(t.request).mock.calls[0][0];
    expect(new URL(req.url).searchParams.get("retstart")).toBe("50");
    expect(new URL(req.url).searchParams.get("api_key")).toBe("test");
  });
  it.each([false,true])("uses the default PubMed quota (key=%s)", async keyed => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const times: number[]=[];
    const t: Transport = {request:async () => {times.push(Date.now());return {body:JSON.stringify({esearchresult:{count:"0",retstart:"0",retmax:"50",idlist:[]}}),status:200,fetchedAt:now};}};
    const c = new PubMedClient(t,keyed ? {apiKey:"test"} : {});
    const requests = [c.search("a"),c.search("b")];
    await vi.runAllTimersAsync(); await Promise.all(requests);
    expect(times[1]-times[0]).toBe(keyed ? 100 : 334);
  });
  it("counts unique papers and excludes future/old years with injected time", () => {
    const base = {pmid:"1",title:"A",year:2021,sourceUrl:"https://pubmed.ncbi.nlm.nih.gov/1/",authors:[{name:"Jane Doe",firstName:"Jane",lastName:"Doe",affiliations:[]}]};
    const a = aggregateAuthors([base,base,{...base,pmid:"2",year:2020},{...base,pmid:"3",year:2027}],new Date(now));
    expect(a[0]).toMatchObject({paperCount:3,recentPaperCount:1});
  });
  it("ignores book chapters, preserves inline text/entities and absent affiliations", () => {
    const records = parsePubmedXml('<PubmedArticleSet><PubmedBookArticle><PMID>999</PMID></PubmedBookArticle><PubmedArticle><PMID>1</PMID><ArticleTitle>A <i>rare</i> &amp; disease</ArticleTitle><PubDate><MedlineDate>2023 Jan-Feb</MedlineDate></PubDate><Author><LastName>Doe</LastName><Initials>J</Initials></Author></PubmedArticle></PubmedArticleSet>');
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({title:"A rare & disease",year:2023});
    expect(records[0].authors[0].affiliations).toEqual([]);
  });
  it("rejects error envelopes and malformed XML", async () => {
    await expect(new PubMedClient(mock({error:"failed"}),{limiter:immediate()}).search("x")).rejects.toBeInstanceOf(SourceError);
    expect(() => parsePubmedXml("<PubmedArticleSet>")).toThrow("Invalid XML");
    expect(parsePubmedXml('<PubmedArticleSet><PubmedArticle><PMID>5</PMID><Journal><ISSN>1</ISSN><Title>Genetics in Medicine</Title></Journal><ArticleTitle>T</ArticleTitle></PubmedArticle></PubmedArticleSet>')[0]!.journal).toBe('Genetics in Medicine');
    expect(() => parsePubmedXml("<eFetchResult><ERROR>failed</ERROR></eFetchResult>")).toThrow("failed");
    await expect(new PubMedClient(mock("{}",500),{limiter:immediate()}).fetch(["1"])).rejects.toMatchObject({status:500});
  });
});

describe("ClinicalTrials.gov", () => {
  it("follows the recorded token into an empty last page", async () => {
    const result = await new CtgovClient(fixture,immediate()).recruitingStudies("IgG4-related disease",{keys:["ctgov/igg4-related-disease/studies.json","ctgov/igg4-related-disease/studies-page2.json"]});
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every(r => r.status === "RECRUITING")).toBe(true);
    expect(result.evidence.every(e => evidenceSchema.safeParse(e).success)).toBe(true);
  });
  it("extracts actual site contacts, central contacts and officials", async () => {
    const result = await new CtgovClient(fixture,immediate()).recruitingStudies("epithelioid sarcoma",{keys:["ctgov/epithelioid-sarcoma/studies.json"]});
    const raw = JSON.parse(await readFile("fixtures/api/ctgov/epithelioid-sarcoma/studies.json","utf8"));
    for (const record of result.records) {
      const p = raw.studies.find((s: {protocolSection:{identificationModule:{nctId:string}}}) => s.protocolSection.identificationModule.nctId === record.nctId).protocolSection;
      expect(record.sites).toEqual(p.contactsLocationsModule?.locations ?? []);
      expect(record.investigators).toEqual(p.contactsLocationsModule?.overallOfficials ?? []);
      expect(record.contacts).toEqual(p.contactsLocationsModule?.centralContacts ?? []);
    }
    expect(result.records.some(r => r.sites.some(s => s.contacts?.length))).toBe(true);
  });
  it("rejects malformed responses and repeated tokens", async () => {
    await expect(new CtgovClient(mock({message:"error"}),immediate()).recruitingStudies("x")).rejects.toThrow("Missing studies");
    await expect(new CtgovClient(mock({studies:[],nextPageToken:"same"}),immediate()).recruitingStudies("x")).rejects.toThrow("Repeated pagination");
    await expect(new CtgovClient(mock({studies:[],nextPageToken:"more"}),immediate()).recruitingStudies("x",{maxPages:1})).rejects.toThrow("incomplete");
  });
});

describe("NPPES", () => {
  it("handles recorded no-match and ambiguous names without choosing one", async () => {
    const c = new NppesClient(fixture,immediate());
    expect((await c.lookup({firstName:"Steven",lastName:"Billings",state:"IN",key:"nppes/epithelioid-sarcoma/billings-steven.json"})).status).toBe("not_found");
    const result = await c.lookup({firstName:"John",lastName:"Stone",state:"MA",key:"nppes/igg4-related-disease/stone-john.json"});
    expect(result.status).toBe("ambiguous"); expect(result.records.length).toBe(3);
    expect(result.evidence.every(e => evidenceSchema.safeParse(e).success)).toBe(true);
  });
  it("requires corroboration, deduplicates NPI, and respects truncation", async () => {
    const provider = {number:1234567890,enumeration_type:"NPI-1",basic:{first_name:"JANE",last_name:"DOE",status:"A",organization_name:"Test Hospital"},addresses:[{state:"MA"}],taxonomies:[{code:"207RR0500X"}]};
    const c = new NppesClient(mock({result_count:2,results:[provider,provider]}),immediate());
    const query = {firstName:"Jane",lastName:"Doe",state:"MA",taxonomy:"207RR0500X",affiliation:"Test Hospital"};
    expect((await c.lookup(query)).status).toBe("verified");
    expect((await c.lookup({...query,taxonomy:undefined})).status).toBe("ambiguous");
    expect((await c.lookup({...query,affiliation:"Some Hospital"})).status).toBe("ambiguous");
    expect((await c.lookup({...query,limit:2})).status).toBe("ambiguous");
  });
  it("rejects registry errors", async () => {
    await expect(new NppesClient(mock({Errors:[{description:"bad query"}]}),immediate()).lookup({firstName:"a",lastName:"b"})).rejects.toThrow("Invalid registry");
  });
});

describe("Exa", () => {
  it.each(["epithelioid-sarcoma","vascular-eds","igg4-related-disease"])("uses recorded returned URLs and fetched text for %s", async disease => {
    const c = new ExaClient(fixture,undefined,immediate());
    const result = await c.search("recorded query",{key:`exa/${disease}/1.json`});
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every(e => result.records.some(r => r.url === e.sourceUrl && r.text?.includes(e.claim)) && evidenceSchema.safeParse(e).success)).toBe(true);
    await expect(c.contents(["https://invented.example"])).rejects.toThrow("not returned");
  });
  it("fetches only previously returned contents and refuses injected result URLs", async () => {
    const requests: SourceRequest[] = [];
    const t: Transport = {request:async req => {requests.push(req);return {body:JSON.stringify({results:[{url:requests.length > 2 ? "https://injected.example" : "https://returned.example",text:requests.length > 1 ? "Fetched content" : undefined}]}),status:200,fetchedAt:now};}};
    const c = new ExaClient(t,undefined,immediate());
    expect((await c.search("q")).evidence).toEqual([]);
    expect((await c.contents(["https://returned.example"])).evidence[0].claim).toBe("Fetched content");
    await expect(c.contents(["https://returned.example"])).rejects.toThrow("Unexpected");
  });
  it("rejects API errors and non-http URLs", async () => {
    await expect(new ExaClient(mock({error:"bad"}),undefined,immediate()).search("x")).rejects.toThrow("Invalid search");
    await expect(new ExaClient(mock({results:[{url:"javascript:alert(1)"}]}),undefined,immediate()).search("x")).rejects.toThrow("Invalid result URL");
  });
});

describe("NCI", () => {
  it("loads every designation including Clinical Cancer Center and fuzzy-matches conservatively", async () => {
    const data = await loadNciCenters();
    expect(data.centers.length).toBe(74);
    expect(data.centers.some(c => c.designation === "Clinical Cancer Center")).toBe(true);
    const match = matchNciCenters("Department of Oncology, Abramson Cancer Center, Philadelphia",data);
    expect(match.records[0].name).toBe("Abramson Cancer Center");
    expect(match.evidence.every(e => evidenceSchema.safeParse(e).success)).toBe(true);
    expect(matchNciCenters("University Hospital Cancer Center",data).records).toEqual([]);
    const fuzzy = matchNciCenters("Memorial Sloan Kettering, Department of Medicine",data);
    expect(fuzzy.records.some(r => r.name.includes("Memorial Sloan-Kettering"))).toBe(true);
  });
});
