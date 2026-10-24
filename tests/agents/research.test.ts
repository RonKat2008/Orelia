import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { researchAgents, researchRegistry } from "@/lib/agents/research";
import type { ResearchContext } from "@/lib/agents/research";
import type { ResearchOutput } from "@/lib/agents/research/shared";
import type { SourcePorts } from "@/lib/agents/research/source-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { agentNameSchema, researchResultSchema, type CaseInput } from "@/lib/contracts";

const runtime = vi.hoisted(() => ({ override: null as null | ((opts: unknown) => Promise<unknown>) }));
vi.mock("@/lib/agents/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/runtime")>();
  return {
    ...actual,
    runAgent: (opts: Parameters<typeof actual.runAgent>[0]) =>
      runtime.override ? runtime.override(opts) : actual.runAgent(opts),
  };
});

const CASES: CaseInput[] = [
  { diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600, goals: ["second_opinion", "trial"] },
  { diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300, goals: ["second_opinion"] },
  { diseaseName: "IgG4-related disease", homeState: "NC", travelLimitMiles: 150, goals: ["second_opinion", "aid"] },
];
const LIVE = ["literature", "trials", "identity", "centers", "advocacy", "aid"] as const;
const STUBS = ["contact_finder", "network", "logistics"] as const;

function context(ports: SourcePorts = createFixturePorts()): ResearchContext {
  return { ports, store: new MemoryRunStore(), caseId: "case-1" };
}

beforeEach(() => {
  vi.stubEnv("WAYFINDER_OFFLINE", "1");
});
afterEach(() => {
  runtime.override = null;
  vi.unstubAllEnvs();
});

describe("registry", () => {
  it("has one agent per AgentName in a fixed order", () => {
    expect(researchAgents.map((a) => a.name)).toEqual([
      "literature", "trials", "identity", "centers", "advocacy", "aid", "contact_finder", "network", "logistics",
    ]);
    for (const name of agentNameSchema.options) expect(researchRegistry[name].name).toBe(name);
  });
});

describe.each(CASES)("live agents with fake ports + offline replay: $diseaseName", (c) => {
  it.each(LIVE)("%s returns a valid ok ResearchResult whose evidence all came from tools", async (name) => {
    const result = await researchRegistry[name].run(c, context());
    expect(researchResultSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.records.length).toBeGreaterThan(0);
    const urls = new Set(result.evidence.flatMap((e) => [e.sourceUrl, ...(e.id ? [e.id] : [])]));
    for (const r of result.records) {
      expect(r.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of r.evidenceRefs) expect(urls.has(ref)).toBe(true);
    }
  });
});

describe("provenance enforcement", () => {
  const caseRecord = CASES[0]!;

  it("drops evidence (and the records that depend on it) whose URL no tool returned", async () => {
    runtime.override = async (opts) => {
      const o = opts as { tools: Array<{ name: string; handler: (i: never) => Promise<unknown> }> };
      const found = (await o.tools[0]!.handler({ query: "Epithelioid sarcoma advocacy foundation" } as never)) as { results: Array<{ url: string }> };
      const real = found.results[0]!.url;
      const out: ResearchOutput = {
        records: [
          { kind: "organization", id: "org:real", name: "Real", organizationKind: "advocacy", url: real as never, evidenceRefs: [real] },
          { kind: "organization", id: "org:fake", name: "Fake", organizationKind: "advocacy", url: "https://invented.example.org/" as never, evidenceRefs: ["https://invented.example.org/"] },
        ],
        evidence: [
          { claimType: "advocacy_organization", claim: "real claim", sourceUrl: real as never },
          { claimType: "advocacy_organization", claim: "invented claim", sourceUrl: "https://invented.example.org/" as never },
        ],
      };
      return out;
    };
    const result = await researchRegistry.advocacy.run(caseRecord, context());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.records.map((r) => r.id)).toEqual(["org:real"]);
    expect(result.evidence.map((e) => e.claim)).toEqual(["real claim"]);
    expect(result.evidence[0]?.sourceKind).toBe("exa");
  });

  it("stamps sourceKind and fetchedAt from the tool call, not the model", async () => {
    runtime.override = async (opts) => {
      const o = opts as { tools: Array<{ handler: (i: never) => Promise<unknown> }> };
      const found = (await o.tools[0]!.handler({ query: "Epithelioid sarcoma advocacy foundation" } as never)) as { results: Array<{ url: string }> };
      const url = found.results[0]!.url;
      return {
        records: [{ kind: "organization", id: "org:a", name: "A", organizationKind: "financial_aid", evidenceRefs: [url] }],
        evidence: [{ claimType: "financial_aid_program", claim: "c", sourceUrl: url, sourceKind: "pubmed", fetchedAt: "1999-01-01T00:00:00.000Z" }],
      };
    };
    const result = await researchRegistry.aid.run(caseRecord, context());
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.evidence[0]?.sourceKind).toBe("exa");
    expect(result.evidence[0]?.fetchedAt).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("strips an NPI, trial id or credential the tools never returned", async () => {
    runtime.override = async (opts) => {
      const o = opts as { tools: Array<{ name: string; handler: (i: never) => Promise<unknown> }> };
      const found = (await o.tools[0]!.handler({ disease: "Epithelioid sarcoma" } as never)) as {
        authors: Array<{ name: string; papers: Array<{ sourceUrl: string }> }>;
      };
      const author = found.authors[0]!;
      const url = author.papers[0]!.sourceUrl;
      return {
        records: [
          { kind: "expert", id: "expert:a", name: author.name, npi: "1999999999", credentials: "FRCS Made Up", evidenceRefs: [url] },
          { kind: "trial", id: "trial:NCT00000000", nctId: "NCT00000000", title: "Invented", evidenceRefs: [url] },
        ],
        evidence: [{ claimType: "disease_publications", claim: "c", sourceUrl: url }],
      };
    };
    const result = await researchRegistry.literature.run(caseRecord, context());
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ kind: "expert", npi: null });
    expect(result.records[0]).not.toHaveProperty("credentials");
  });

  it("returns an error result (not a throw) when a port fails", async () => {
    const ports = createFixturePorts();
    const failing: SourcePorts = { ...ports, exa: { search: async () => { throw new Error("exa down"); } } };
    const result = await researchRegistry.advocacy.run(caseRecord, context(failing));
    expect(result).toEqual({ status: "error", message: "exa down" });
  });
});

describe("identity never guesses", () => {
  it("leaves npi null when NPPES returns several exact name matches, and only the unique match is verified", async () => {
    const result = await researchRegistry.identity.run(CASES[2]!, context());
    if (result.status !== "ok") throw new Error("expected ok");
    const experts = result.records.flatMap((r) => (r.kind === "expert" ? [r] : []));
    const sharma = experts.find((e) => e.name === "Amita Sharma");
    const stone = experts.find((e) => e.name === "John Stone");
    expect(sharma?.npi ?? null).toBeNull();
    expect(stone?.npi ?? null).toBeNull();
    const verified = experts.filter((e) => e.npi);
    expect(verified.length).toBeGreaterThan(0);
    for (const e of verified) {
      expect(e.evidenceRefs[0]).toBe(`https://npiregistry.cms.hhs.gov/provider-view/${e.npi}`);
    }
  });

  it("overrides a model that claims an NPI for an ambiguous match", async () => {
    runtime.override = async (opts) => {
      const o = opts as { tools: Array<{ name: string; handler: (i: never) => Promise<unknown> }> };
      const lookup = o.tools.find((t) => t.name === "lookup_npi")!;
      const out = (await lookup.handler({ firstName: "Amita", lastName: "Sharma" } as never)) as {
        searchUrl: string;
        exactNameMatches: number;
        matches: Array<{ npi: string; sourceUrl: string }>;
      };
      expect(out.exactNameMatches).toBeGreaterThan(1);
      const guess = out.matches[0]!;
      return {
        records: [{ kind: "expert", id: `npi:${guess.npi}`, name: "Amita Sharma", npi: guess.npi, evidenceRefs: [guess.sourceUrl] }],
        evidence: [{ claimType: "identity_verified", claim: "guessed", sourceUrl: guess.sourceUrl }],
      };
    };
    const result = await researchRegistry.identity.run(CASES[2]!, context());
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.records[0]).toMatchObject({ npi: null });
  });
});

describe("stubs", () => {
  it.each(STUBS)("%s returns not_implemented without calling a model", async (name) => {
    const spy = vi.fn();
    runtime.override = async (o) => {
      spy(o);
      return {};
    };
    const store = new MemoryRunStore();
    const result = await researchRegistry[name].run(CASES[0]!, { ports: createFixturePorts(), store, caseId: "c" });
    expect(result).toEqual({ status: "not_implemented" });
    expect(spy).not.toHaveBeenCalled();
    expect(await store.listByCase("c")).toHaveLength(0);
  });
});
