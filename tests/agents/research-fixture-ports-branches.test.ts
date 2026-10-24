import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";

const SARCOMA = "epithelioid-sarcoma";
const NOW_YEAR = 2026;

let root: string;
const write = (rel: string, body: unknown) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
};

const author = (fore: string | undefined, last: string | undefined, affiliation?: string) =>
  `<Author ValidYN="Y">${last ? `<LastName>${last}</LastName>` : ""}${fore ? `<ForeName>${fore}</ForeName>` : ""}${affiliation ? `<AffiliationInfo><Affiliation>${affiliation}</Affiliation></AffiliationInfo>` : ""}</Author>`;
const article = (pmid: string | undefined, title: string | undefined, year: number | undefined, authors: string, listAttrs = 'Type="authors"') =>
  `<PubmedArticle>${pmid ? `<PMID Version="1">${pmid}</PMID>` : ""}<PubDate>${year ? `<Year>${year}</Year>` : ""}</PubDate>${title ? `<ArticleTitle>${title}</ArticleTitle>` : ""}<AuthorList ${listAttrs}>${authors}</AuthorList></PubmedArticle>`;
const xml = (...articles: string[]) => `<PubmedArticleSet>${articles.join("")}</PubmedArticleSet>`;
const nppesRecord = (over: Record<string, unknown> = {}) => ({
  number: 1234567893,
  basic: { first_name: "Jordan", last_name: "Testwell", credential: "MD" },
  addresses: [
    { address_purpose: "MAILING", city: "MAILCITY", state: "NM" },
    { address_purpose: "LOCATION", city: "PHOENIX", state: "AZ" },
  ],
  taxonomies: [{ desc: "Internal Medicine" }, { desc: "Pathology", primary: true }],
  ...over,
});

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "wayfinder-fixture-ports-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("fixture pubmed port: article parsing", () => {
  it("parses books, entities, middle names, years, editors and drops incomplete authors and articles", async () => {
    // Arrange
    write(
      `fixtures/api/pubmed/${SARCOMA}/efetch.xml`,
      xml(
        article(
          "1",
          "Sarcoma &amp; &lt;b&gt;Care&lt;/b&gt; &#x41;&#66; <i>in</i> &quot;trials&quot; &gt; all",
          2025,
          author("Jordan Quinn", "Testwell", "Dept, Phoenix, Arizona.") + author("Zed", "Editorlike") + author("Q.", "Initialsonly") + author("Nolast", undefined) + author(undefined, "Nofirst"),
        ),
        article("2", "Second paper", 2010, author("Jordan Quinn", "Testwell", "Elsewhere, Utah.") + author("Ana", "Nowhere")),
        article("3", "Undated paper", undefined, author("Jordan Quinn", "Testwell")),
        article(undefined, "No pmid", 2025, author("Jordan", "Testwell")),
        article("5", undefined, 2025, author("Jordan", "Testwell")),
        article("6", "Editors only", 2025, author("Jordan", "Testwell"), 'Type="editors"'),
        `<PubmedBookArticle><PMID>7</PMID><BookTitle>A Book Title</BookTitle><AuthorList Type="authors">${author("Jordan", "Testwell")}</AuthorList></PubmedBookArticle>`,
      ),
    );
    write(`fixtures/api/nppes/${SARCOMA}/testwell-jordan.json`, { result_count: 1, results: [] });
    const ports = createFixturePorts({ root, asOfYear: NOW_YEAR, strict: false });
    // Act
    const hits = await ports.pubmed.searchAuthors({ disease: "Epithelioid sarcoma" });
    // Assert: only Jordan has an NPPES fixture; editors-only list is excluded; Ana and Zed are skipped
    expect(hits).toHaveLength(1);
    const jordan = hits[0]!;
    expect(jordan).toMatchObject({ name: "Jordan Testwell", firstName: "Jordan", middleName: "Quinn", state: "AZ", paperCount: 4, recentPaperCount: 1 });
    expect(jordan.affiliation).toBe("Dept, Phoenix, Arizona.");
    expect(jordan.papers.map((p) => p.pmid)).toEqual(["1", "2", "3", "7"]);
    expect(jordan.papers[0]?.title).toBe('Sarcoma & <b>Care</b> AB in "trials" > all');
    expect(jordan.papers.find((p) => p.pmid === "3")?.year).toBeUndefined();
    expect(jordan.papers.find((p) => p.pmid === "7")?.title).toBe("A Book Title");
  });

  it("ignores a repeated pmid for the same author (no double counting)", async () => {
    // Arrange
    write(
      `fixtures/api/pubmed/vascular-eds/efetch.xml`,
      xml(
        article("10", "Vascular paper", 2025, author("Casey", "Dupe") + author("Casey", "Dupe", "Home, Texas.")),
        article("10", "Vascular paper", 2025, author("Casey", "Dupe")),
      ),
    );
    write(`fixtures/api/nppes/vascular-eds/dupe-casey.json`, { result_count: 0, results: [] });
    const ports = createFixturePorts({ root, asOfYear: NOW_YEAR, strict: false });
    // Act
    const hits = await ports.pubmed.searchAuthors({ disease: "Vascular Ehlers-Danlos" });
    // Assert
    expect(hits).toHaveLength(1);
    expect(hits[0]?.paperCount).toBe(1);
    expect(hits[0]?.state).toBeUndefined();
  });

  it("keeps the first affiliation and state seen for an author across papers", async () => {
    // Arrange
    write(
      `fixtures/api/pubmed/igg4-related-disease/efetch.xml`,
      xml(
        article("20", "IgG4 one", 2025, author("Lee", "Keeper")),
        article("21", "IgG4 two", 2024, author("Lee", "Keeper", "A Clinic, Texas.")),
        article("22", "IgG4 three", 2023, author("Lee", "Keeper", "Other Clinic, Utah.")),
      ),
    );
    write(`fixtures/api/nppes/igg4-related-disease/keeper-lee.json`, { result_count: 0, results: [] });
    const ports = createFixturePorts({ root, asOfYear: NOW_YEAR, strict: false });
    // Act
    const [hit] = await ports.pubmed.searchAuthors({ disease: "IgG4-related disease" });
    // Assert
    expect(hit).toMatchObject({ affiliation: "A Clinic, Texas.", state: "TX", paperCount: 3 });
  });

  it("sorts by paper count, then recent count, then name, and applies the limit", async () => {
    // Arrange
    const a = (name: string) => author(name, "Sortcase");
    write(
      `fixtures/api/pubmed/sort-case/efetch.xml`,
      xml(
        article("30", "p30", 2000, a("Bob") + a("Amy") + a("Cat")),
        article("31", "p31", 2025, a("Cat") + a("Dan")),
        article("32", "p32", 2025, a("Dan")),
        article("33", "p33", 2000, a("Eve")),
      ),
    );
    for (const n of ["bob", "amy", "cat", "dan", "eve"]) write(`fixtures/api/nppes/sort-case/sortcase-${n}.json`, { result_count: 0, results: [] });
    const ports = createFixturePorts({ root, asOfYear: NOW_YEAR, strict: false });
    // Act
    const all = await ports.pubmed.searchAuthors({ disease: "sort case" });
    const top2 = await ports.pubmed.searchAuthors({ disease: "sort case", limit: 2 });
    // Assert
    expect(all.map((h) => h.firstName)).toEqual(["Dan", "Cat", "Amy", "Bob", "Eve"]);
    expect(top2.map((h) => h.firstName)).toEqual(["Dan", "Cat"]);
  });
});

describe("fixture pubmed port: strict recordings", () => {
  beforeAll(() => {
    write(`fixtures/api/pubmed/strict-case/efetch.xml`, xml(article("40", "Original sample", 2025, author("Orig", "Person"))));
    write(`fixtures/api/pubmed/strict-case/efetch-strict-1.xml`, xml(article("41", "Strict one", 2025, author("Stan", "Person"))));
    write(`fixtures/api/pubmed/strict-case/efetch-strict-2.xml`, xml(article("42", "Strict two", 2025, author("Sara", "Person"))));
    for (const n of ["orig", "stan", "sara"]) write(`fixtures/api/nppes/strict-case/person-${n}.json`, { result_count: 0, results: [] });
    write(`fixtures/api/nppes/strict-case/strict-person-sara.json`, { result_count: 0, results: [] });
  });

  it("reads every numbered strict recording and requires the strict NPPES file when present", async () => {
    // Act
    const hits = await createFixturePorts({ root, asOfYear: NOW_YEAR }).pubmed.searchAuthors({ disease: "strict case" });
    // Assert
    expect(hits.map((h) => h.name).sort()).toEqual(["Sara Person", "Stan Person"]);
  });

  it("pins the original sample when strict is false", async () => {
    const hits = await createFixturePorts({ root, asOfYear: NOW_YEAR, strict: false }).pubmed.searchAuthors({ disease: "strict case" });
    expect(hits.map((h) => h.name)).toEqual(["Orig Person"]);
  });

  it("defaults asOfYear to the current year", async () => {
    const [hit] = await createFixturePorts({ root }).pubmed.searchAuthors({ disease: "strict case" });
    expect(hit?.recentPaperCount).toBe(0 + (2025 >= new Date().getFullYear() - 5 ? 1 : 0));
  });
});

describe("fixture ctgov port", () => {
  const study = (over: Record<string, unknown> = {}) => ({
    protocolSection: {
      identificationModule: { nctId: "NCT00000001", briefTitle: "Full trial" },
      statusModule: { overallStatus: "RECRUITING" },
      designModule: { phases: ["PHASE2"] },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Sponsor" } },
      contactsLocationsModule: {
        locations: [{ facility: "Site", city: "Phoenix", state: "AZ", country: "United States", status: "RECRUITING" }],
        overallOfficials: [{ name: "Dr. Lead" }, {}],
        centralContacts: [{ phone: "602-555-0100", email: "c@example.org" }],
      },
      conditionsModule: { conditions: ["Cond"], keywords: ["kw"] },
      eligibilityModule: { stdAges: ["ADULT"], minimumAge: "18 Years", maximumAge: "80 Years" },
    },
    derivedSection: { conditionBrowseModule: { meshes: [{ term: "Mesh One" }] } },
    ...over,
  });

  it("maps all registry sections from both pages", async () => {
    // Arrange
    write("fixtures/api/ctgov/epithelioid-sarcoma/studies.json", { studies: [study()] });
    write("fixtures/api/ctgov/epithelioid-sarcoma/studies-page2.json", { studies: [study({ protocolSection: { ...study().protocolSection, identificationModule: { nctId: "NCT00000002", briefTitle: "Page two" } } })] });
    // Act
    const out = await createFixturePorts({ root }).ctgov.recruitingStudies({ condition: "Epithelioid sarcoma" });
    // Assert
    expect(out.map((s) => s.nctId)).toEqual(["NCT00000001", "NCT00000002"]);
    expect(out[0]).toMatchObject({
      phases: ["PHASE2"],
      sponsor: "Sponsor",
      conditions: ["Cond"],
      keywords: ["kw"],
      meshTerms: ["Mesh One"],
      stdAges: ["ADULT"],
      minimumAge: "18 Years",
      maximumAge: "80 Years",
      investigators: ["Dr. Lead"],
      hasContact: true,
      centralContacts: [{ phone: "602-555-0100", email: "c@example.org" }],
    });
    expect(out[0]?.sites[0]).toMatchObject({ facility: "Site", city: "Phoenix", state: "AZ" });
  });

  it("defaults optional sections to empty values", async () => {
    // Arrange
    write("fixtures/api/ctgov/bare-case/studies.json", {
      studies: [{ protocolSection: { identificationModule: { nctId: "NCT00000003", briefTitle: "Bare" }, statusModule: { overallStatus: "RECRUITING" } } }],
    });
    // Act
    const [bare] = await createFixturePorts({ root }).ctgov.recruitingStudies({ condition: "bare case" });
    // Assert
    expect(bare).toMatchObject({ sites: [], conditions: [], keywords: [], meshTerms: [], stdAges: [], investigators: [], hasContact: false, centralContacts: [] });
    expect(bare?.phases).toBeUndefined();
    expect(bare?.sponsor).toBeUndefined();
  });

  it("returns an empty list when no recording exists for the condition", async () => {
    expect(await createFixturePorts({ root }).ctgov.recruitingStudies({ condition: "never recorded" })).toEqual([]);
  });

  it("reads only the second page when the first is absent", async () => {
    write("fixtures/api/ctgov/page-two-only/studies-page2.json", { studies: [study()] });
    const out = await createFixturePorts({ root }).ctgov.recruitingStudies({ condition: "page two only" });
    expect(out).toHaveLength(1);
  });
});

describe("fixture nppes port", () => {
  beforeAll(() => {
    write("fixtures/api/MANIFEST.json", [
      { file: "nppes/epithelioid-sarcoma/testwell-jordan.json", url: "https://npiregistry.cms.hhs.gov/api/?first_name=Jordan&limit=2" },
      { file: "nppes/vascular-eds/capped-casey.json", url: "https://npiregistry.cms.hhs.gov/api/?first_name=Casey&limit=2" },
    ]);
    write("fixtures/api/nppes/epithelioid-sarcoma/testwell-jordan.json", { result_count: 1, results: [nppesRecord()] });
    write("fixtures/api/nppes/vascular-eds/capped-casey.json", { result_count: 2, results: [nppesRecord({ addresses: undefined, taxonomies: [{ desc: "First" }], basic: {} })] });
    write("fixtures/api/nppes/igg4-related-disease/unlisted-una.json", { result_count: 10, results: [nppesRecord({ taxonomies: undefined })] });
    write("fixtures/api/nppes/epithelioid-sarcoma/strict-pref-pat.json", { result_count: 0, results: [] });
    write("fixtures/api/nppes/epithelioid-sarcoma/pref-pat.json", { result_count: 1, results: [nppesRecord({ number: 1000000004 })] });
  });

  it("maps a recorded provider using the LOCATION address and primary taxonomy", async () => {
    // Act
    const result = await createFixturePorts({ root }).nppes.lookup({ firstName: "Jordan", lastName: "Testwell" });
    // Assert
    expect(result.searchUrl).toContain("first_name=Jordan");
    expect(result.truncated).toBe(false);
    expect(result.providers[0]).toMatchObject({ npi: "1234567893", city: "PHOENIX", state: "AZ", taxonomy: "Pathology", credential: "MD", firstName: "Jordan" });
    expect(result.providers[0]?.raw?.number).toBe("1234567893");
  });

  it("searches case folders in order and falls back to first taxonomy, no address, blank names; truncated at the manifest limit", async () => {
    // Act
    const result = await createFixturePorts({ root }).nppes.lookup({ firstName: "Casey", lastName: "Capped" });
    // Assert
    expect(result.truncated).toBe(true);
    expect(result.providers[0]).toMatchObject({ firstName: "", lastName: "", taxonomy: "First" });
    expect(result.providers[0]?.city).toBeUndefined();
  });

  it("uses a fixture:// URL and a default limit of 10 when the file is not in the manifest", async () => {
    // Act
    const result = await createFixturePorts({ root }).nppes.lookup({ firstName: "Una", lastName: "Unlisted" });
    // Assert
    expect(result.searchUrl).toBe("fixture://nppes/igg4-related-disease/unlisted-una.json");
    expect(result.truncated).toBe(true);
    expect(result.providers[0]?.taxonomy).toBeUndefined();
  });

  it("prefers a strict recording unless strict mode is off", async () => {
    // Act
    const strict = await createFixturePorts({ root }).nppes.lookup({ firstName: "Pat", lastName: "Pref" });
    const loose = await createFixturePorts({ root, strict: false }).nppes.lookup({ firstName: "Pat", lastName: "Pref" });
    // Assert
    expect(strict.providers).toEqual([]);
    expect(loose.providers[0]?.npi).toBe("1000000004");
  });

  it("throws when no fixture was recorded for the person", async () => {
    await expect(createFixturePorts({ root }).nppes.lookup({ firstName: "No", lastName: "Body" })).rejects.toThrow("No NPPES fixture recorded for No Body");
  });
});

describe("fixture exa port", () => {
  beforeAll(() => {
    for (const slug of ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"]) {
      for (const n of [1, 2, 3]) write(`fixtures/api/exa/${slug}/${n}.json`, { results: [{ url: `https://example.org/${slug}/${n}`, title: `T${n}`, text: n === 3 ? undefined : "text" }] });
    }
  });

  it.each([
    ["epithelioid sarcoma advocacy group", "epithelioid-sarcoma", 1],
    ["Ehlers-Danlos support group", "vascular-eds", 1],
    ["IgG4 foundation", "igg4-related-disease", 1],
    ["epithelioid sarcoma copay assistance", "epithelioid-sarcoma", 2],
    ["ehlers lodging", "vascular-eds", 2],
    ["igg4 grant", "igg4-related-disease", 2],
    ["epithelioid sarcoma treatment centers", "epithelioid-sarcoma", 3],
    ["ehlers specialists", "vascular-eds", 3],
  ])("routes %s to recording %s/%i", async (query, slug, n) => {
    // Act
    const [first] = await createFixturePorts({ root }).exa.search({ query });
    // Assert
    expect(first).toMatchObject({ url: `https://example.org/${slug}/${n}`, title: `T${n}` });
  });

  it("throws for queries about an unrecorded disease", async () => {
    await expect(createFixturePorts({ root }).exa.search({ query: "lupus advocacy" })).rejects.toThrow("No Exa fixture for query: lupus advocacy");
  });
});

describe("fixture centers port", () => {
  beforeAll(() => {
    const c = (name: string, state: string, designation = "Comprehensive Cancer Center") => ({ name, city: "X", state, designation, url: `https://www.cancer.gov/${name}` });
    write("data/nci-centers.json", {
      centers: [c("Zeta", "AZ"), c("Alpha", "AZ"), c("Utah Center", "UT"), c("NM Center", "NM"), c("Clinical", "AZ", "Cancer Center"), c("NY Center", "NY"),
        ...Array.from({ length: 10 }, (_v, i) => c(`CA ${String(i).padStart(2, "0")}`, "CA"))],
    });
  });

  it("returns nothing for non-cancer diseases", async () => {
    expect(await createFixturePorts({ root }).centers.match({ diseaseName: "lupus", homeState: "AZ" })).toEqual([]);
  });

  it("returns nothing for a cancer without a home state", async () => {
    expect(await createFixturePorts({ root }).centers.match({ diseaseName: "sarcoma" })).toEqual([]);
  });

  it("orders AZ neighbours by proximity list then name, excluding non-comprehensive and far states, capped at 8", async () => {
    // Act
    const out = await createFixturePorts({ root }).centers.match({ diseaseName: "epithelioid sarcoma", homeState: "AZ" });
    // Assert
    expect(out.map((c) => c.name)).toEqual(["Alpha", "Zeta", "NM Center", "Utah Center", ...Array.from({ length: 4 }, (_v, i) => `CA ${String(i).padStart(2, "0")}`)]);
  });

  it("uses only the home state when it has no neighbour list", async () => {
    const out = await createFixturePorts({ root }).centers.match({ diseaseName: "cancer", homeState: "NY" });
    expect(out.map((c) => c.name)).toEqual(["NY Center"]);
  });
});
