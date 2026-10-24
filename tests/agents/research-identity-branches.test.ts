import { afterEach, describe, expect, it, vi } from "vitest";
import { identityAgent, nppesContactEvidence, nppesProviderUrl } from "@/lib/agents/research/identity";
import type { NppesPort, PubmedAuthorHit, SourcePorts } from "@/lib/agents/research/source-ports";
import type { NppesProvider as RawProvider } from "@/lib/sources/nppes";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";

const runtime = vi.hoisted(() => ({ override: null as null | (() => unknown) }));
vi.mock("@/lib/agents/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/runtime")>();
  return { ...actual, runAgent: (options: Parameters<typeof actual.runAgent>[0]) => (runtime.override ? runtime.override() : actual.runAgent(options)) };
});
afterEach(() => {
  runtime.override = null;
});

const NPI = "1568608651";
const SEARCH_URL = "https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=Jerad&last_name=Gardner";
const PROVIDER_URL = nppesProviderUrl(NPI);
const AFFILIATION = "Department of Pathology, Example Medical Center, Danville, PA";
const CASE = { diseaseName: "Epithelioid sarcoma", goals: [] };

const provider = (over: Partial<RawProvider> = {}): RawProvider => ({
  number: NPI,
  enumeration_type: "NPI-1",
  basic: { first_name: "JERAD", last_name: "GARDNER", credential: "MD", status: "A" },
  addresses: [{ address_purpose: "LOCATION", city: "DANVILLE", state: "PA", telephone_number: "570-271-6338" }],
  taxonomies: [{ code: "207ZP0102X", desc: "Pathology, Anatomic Pathology", primary: true }],
  ...over,
});

const hit = (over: Partial<PubmedAuthorHit> = {}): PubmedAuthorHit => ({
  name: "Jerad Gardner",
  firstName: "Jerad",
  lastName: "Gardner",
  affiliation: AFFILIATION,
  state: "PA",
  paperCount: 2,
  recentPaperCount: 1,
  papers: [{ pmid: "1", title: "Epithelioid sarcoma review", year: new Date().getFullYear() }],
  ...over,
});

interface Setup {
  authors?: PubmedAuthorHit[] | (() => PubmedAuthorHit[]);
  providers?: RawProvider[];
  truncated?: boolean | undefined;
  nppes?: NppesPort;
}

function ports(setup: Setup = {}): SourcePorts {
  const base = createFixturePorts();
  const providers = setup.providers ?? [provider()];
  return {
    ...base,
    pubmed: { searchAuthors: async () => (typeof setup.authors === "function" ? setup.authors() : (setup.authors ?? [hit()])) },
    nppes:
      setup.nppes ??
      ({
        lookup: async () => ({
          searchUrl: SEARCH_URL,
          ...("truncated" in setup ? { truncated: setup.truncated } : { truncated: false }),
          providers: providers.map((r) => ({
            npi: String(r.number),
            raw: r,
            firstName: r.basic.first_name ?? "",
            lastName: r.basic.last_name ?? "",
            credential: r.basic.credential,
            taxonomy: r.taxonomies?.[0]?.desc,
            city: r.addresses?.[0]?.city,
            state: r.addresses?.[0]?.state,
          })),
        }),
      } satisfies NppesPort),
  };
}

const modelOutput = (record: Record<string, unknown>, evidenceUrl = SEARCH_URL) => ({
  records: [{ kind: "expert", id: "expert:jerad-gardner", name: "Jerad Gardner", npi: null, evidenceRefs: [evidenceUrl], ...record }],
  evidence: [{ claimType: "identity_unverified", claim: "model prose to be discarded", sourceUrl: evidenceUrl }],
});

async function run(setup: Setup, model: unknown) {
  runtime.override = () => model;
  const result = await identityAgent.run(CASE, { ports: ports(setup), store: new MemoryRunStore(), caseId: "identity-branches" });
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result;
}

describe("nppesContactEvidence", () => {
  it("returns null without a provider or when the NPI differs", () => {
    expect(nppesContactEvidence(NPI, undefined, "t")).toBeNull();
    expect(nppesContactEvidence("1000000004", provider(), "t")).toBeNull();
  });

  it("returns null when the LOCATION address has no usable phone", () => {
    expect(nppesContactEvidence(NPI, provider({ addresses: [{ address_purpose: "MAILING", telephone_number: "570-271-6338" }] }), "t")).toBeNull();
    expect(nppesContactEvidence(NPI, provider({ addresses: [{ address_purpose: "LOCATION", telephone_number: "123" }] }), "t")).toBeNull();
    expect(nppesContactEvidence(NPI, provider({ addresses: undefined }), "t")).toBeNull();
  });

  it("stamps an E.164 voice contact point from the practice location phone", () => {
    // Act
    const evidence = nppesContactEvidence(NPI, provider(), "2026-10-24T00:00:00.000Z");
    // Assert
    expect(evidence).toMatchObject({ claim: "+15702716338", sourceUrl: PROVIDER_URL, sourceKind: "nppes", claimType: "contact_point.voice.nppes_location_phone" });
  });
});

describe("identityAgent verification outcomes", () => {
  it("verifies a corroborated clinician and stamps credentials, specialty, profile and the practice phone", async () => {
    // Act
    const result = await run({}, modelOutput({ credentials: "DO", specialty: "invented" }));
    // Assert
    expect(result.records[0]).toMatchObject({
      npi: NPI,
      verified: true,
      credentials: "MD",
      specialty: "Pathology, Anatomic Pathology",
      name: "Jerad Gardner",
      profile: { paperCount: 1, recentPaperCount: 1 },
      evidenceRefs: [PROVIDER_URL],
    });
    expect(result.evidence.map((e) => e.claimType)).toEqual(["identity_verified", "contact_point.voice.nppes_location_phone"]);
    expect(result.evidence[0]?.claim).toContain("NPI verified");
  });

  it("omits credentials and specialty when the registry record has neither", async () => {
    // Arrange
    const bare = provider({ basic: { first_name: "JERAD", last_name: "GARDNER", status: "A" }, taxonomies: [{ code: "207ZP0102X", desc: "Pathology, Anatomic Pathology" }], addresses: [{ address_purpose: "LOCATION", city: "DANVILLE", state: "PA" }] });
    // Act
    const result = await run({ providers: [bare] }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ npi: NPI, verified: true, credentials: undefined, specialty: undefined });
    expect(result.evidence).toHaveLength(1);
  });

  it("never verifies when the registry result may be truncated, including when the port does not say", async () => {
    // Act
    const explicit = await run({ truncated: true }, modelOutput({}));
    const unspecified = await run({ truncated: undefined }, modelOutput({}));
    // Assert
    for (const result of [explicit, unspecified]) {
      expect(result.records[0]).toMatchObject({ npi: null, verified: false });
      expect(result.evidence[0]?.claimType).toBe("identity_unverified");
      expect(result.evidence[0]?.claim).toContain("registry results may be truncated");
      expect(result.evidence[0]?.sourceUrl).toBe(SEARCH_URL);
    }
  });

  it("rejects the author when the port returns providers without raw registry data", async () => {
    // Arrange
    const nppes: NppesPort = {
      lookup: async () => ({ searchUrl: SEARCH_URL, truncated: false, providers: [{ npi: NPI, firstName: "Jerad", lastName: "Gardner" }] }),
    };
    // Act
    const result = await run({ nppes }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ npi: null, verified: false });
    expect(result.evidence[0]?.claim).toContain("no registry matches");
  });

  it("treats two PubMed rows with conflicting middle initials as ambiguous namesakes", async () => {
    // Arrange
    const authors = [hit({ middleName: "Michael" }), hit({ middleName: "Quentin", papers: [{ pmid: "2", title: "Epithelioid sarcoma again", year: 2020 }] })];
    // Act
    const result = await run({ authors }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ npi: null, verified: false, profile: { paperCount: 2 } });
    expect(result.evidence[0]?.claim).toContain("registry results may be truncated");
  });

  it("merges PubMed rows that differ only by a blank middle name, keeping the longest paper list and name", async () => {
    // Arrange
    const authors = [hit({ middleName: "" }), hit({ middleName: "M", name: "Jerad M Gardner", paperCount: 5, affiliation: undefined, affiliations: [AFFILIATION] })];
    // Act
    const result = await run({ authors }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ name: "Jerad M Gardner" });
  });

  it("verifies from a PubMed row that carries only the affiliations array", async () => {
    const result = await run({ authors: [hit({ affiliation: undefined, affiliations: [AFFILIATION] })] }, modelOutput({}));
    expect(result.records[0]).toMatchObject({ npi: NPI, verified: true });
  });

  it("cannot corroborate a practice location when PubMed gave no affiliation", async () => {
    // Act
    const result = await run({ authors: [hit({ affiliation: undefined, affiliations: undefined })] }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ npi: null, verified: false });
    expect(result.evidence[0]?.claim).toContain("NPI probable");
  });
});

describe("identityAgent model output handling", () => {
  it("falls back to the model name and a rejected summary for people the deterministic lookup never assessed", async () => {
    // Arrange
    const model = modelOutput({ id: "expert:someone-else", name: "Someone Else", npi: "9999999999", credentials: "MD" });
    // Act
    const result = await run({}, model);
    // Assert
    expect(result.records[0]).toMatchObject({ name: "Someone Else", npi: null, verified: false, profile: { paperCount: 0, recentPaperCount: 0 } });
    expect(result.evidence[0]?.claimType).toBe("identity_unverified");
    expect(result.evidence[0]?.claim).toMatch(/^NPI rejected: no corroborated author/);
  });

  it("counts only papers that mention the disease exactly and only recent ones as recent", async () => {
    // Arrange
    const year = new Date().getFullYear();
    const papers = [
      { pmid: "1", title: "Epithelioid sarcoma review", year },
      { pmid: "2", title: "Epithelioid sarcoma, long ago", year: year - 10 },
      { pmid: "3", title: "Epithelioid sarcoma undated" },
      { pmid: "4", title: "Unrelated cardiology paper", year },
    ];
    // Act
    const result = await run({ authors: [hit({ papers })] }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ profile: { paperCount: 3, recentPaperCount: 1 } });
  });

  it("falls back to the lookup without PubMed hits (lookup for an author PubMed no longer lists)", async () => {
    // Arrange: the identity agent's own author fetch returns nothing; the seed's tool call returns the author
    let calls = 0;
    const authors = () => (calls++ === 0 ? [] : [hit()]);
    // Act
    const result = await run({ authors }, modelOutput({}));
    // Assert
    expect(result.records[0]).toMatchObject({ npi: null, verified: false });
    expect(result.records[0]).toMatchObject({ name: "Jerad Gardner" });
  });

  it("omits the state argument when the author has none", async () => {
    // Arrange
    const lookup = vi.fn(async () => ({ searchUrl: SEARCH_URL, truncated: false, providers: [] }));
    // Act
    await run({ authors: [hit({ state: undefined })], nppes: { lookup } }, modelOutput({}));
    // Assert
    expect(lookup).toHaveBeenCalledWith({ firstName: "Jerad", lastName: "Gardner", state: undefined });
  });

  it("returns non-ok research results unchanged", async () => {
    // Arrange
    runtime.override = () => {
      throw new Error("model unavailable");
    };
    // Act
    const result = await identityAgent.run(CASE, { ports: ports(), store: new MemoryRunStore(), caseId: "identity-error" });
    // Assert
    expect(result).toEqual({ status: "error", message: "model unavailable" });
  });

  it("drops a model record that cites evidence no tool returned", async () => {
    // Act
    const result = await run({}, { records: [{ kind: "expert", id: "x", name: "Jerad Gardner", npi: null, evidenceRefs: ["https://invented.example/"] }], evidence: [{ claimType: "c", claim: "x", sourceUrl: "https://invented.example/" }] });
    // Assert
    expect(result.records).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
});
