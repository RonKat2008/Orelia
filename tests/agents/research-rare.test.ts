import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { researchRegistry } from "@/lib/agents/research";
import type { ResearchContext } from "@/lib/agents/research";
import { diseaseFundClaimType } from "@/lib/agents/research/disease-funds";
import { keepContactRegistry, rareNetworkClaimType } from "@/lib/agents/research/rare-network";
import { secondOpinionClaimType } from "@/lib/agents/research/second-opinion";
import { ProvenanceTracker } from "@/lib/agents/research/shared";
import { withBudget } from "@/lib/agents/research/site-search-tool";
import type { ExaPort, SourcePorts } from "@/lib/agents/research/source-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { researchResultSchema, type CaseInput } from "@/lib/contracts";
import { rareTags } from "@/lib/rare-disease/tags";

const CASES: CaseInput[] = [
  { diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600, goals: ["second_opinion", "trial"] },
  { diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300, goals: ["second_opinion"] },
  { diseaseName: "IgG4-related disease", homeState: "NC", travelLimitMiles: 150, goals: ["second_opinion", "aid"] },
];
const VEDS = CASES[1];
const IGG4 = CASES[2];
const UNDIAGNOSED: CaseInput = { diseaseName: "Undiagnosed condition", undiagnosed: true, goals: ["second_opinion"] };
const RARE = ["rare_network", "disease_funds", "second_opinion"] as const;
const CLAIM_TYPES: Record<(typeof RARE)[number], readonly string[]> = {
  rare_network: ["rdcrn_consortium", "patient_registry", "udn_intake"],
  disease_funds: ["disease_fund", "financial_aid_program"],
  second_opinion: ["nord_center_of_excellence", "second_opinion_program", "telehealth_program", "genetics_clinic"],
};

const context = (ports: SourcePorts = createFixturePorts()): ResearchContext => ({ ports, store: new MemoryRunStore(), caseId: "case-1" });

beforeEach(() => vi.stubEnv("WAYFINDER_OFFLINE", "1"));
afterEach(() => vi.unstubAllEnvs());

describe.each(CASES)("rare-disease directory agents, offline replay: $diseaseName", (c) => {
  it.each(RARE)("%s returns verified records whose evidence came from its own tools", async (name) => {
    const result = researchResultSchema.parse(await researchRegistry[name].run(c, context()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    for (const e of result.evidence.filter((x) => !x.id?.startsWith("cp:") && !x.claimType.startsWith("contact") && !x.claimType.startsWith("web_form"))) {
      expect(e.sourceKind).toBe("exa");
    }
    const claimTypes = new Set(result.evidence.map((e) => e.claimType));
    expect([...claimTypes].some((t) => CLAIM_TYPES[name].includes(t)) || result.records.length === 0).toBe(true);
    for (const r of result.records) expect(r.evidenceRefs.length).toBeGreaterThan(0);
  });
});

describe("rare-disease tags fill from code-stamped claim types", () => {
  it("vEDS research networks are registries tagged RDCRN or registry", async () => {
    const result = await researchRegistry.rare_network.run(CASES[1], context());
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.records.length).toBeGreaterThan(0);
    for (const r of result.records) expect(r.kind === "organization" && r.organizationKind).toBe("registry");
    const tags = rareTags(result.evidence);
    expect(tags.some((t) => t === "rdcrn" || t === "registry")).toBe(true);
  });

  it("second opinions for vEDS are institutions", async () => {
    const result = await researchRegistry.second_opinion.run(CASES[1], context());
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((r) => r.kind === "institution")).toBe(true);
  });
});

describe("claim types are decided by code, never by the model", () => {
  const tracker = (url: string, tag: string, text: string): ProvenanceTracker => {
    const t = new ProvenanceTracker();
    t.collect("exa", { results: [{ url, excerpt: text }] });
    t.tagUrl(url, tag);
    return t;
  };
  const item = (sourceUrl: string, claimType = "anything") => ({ claimType, claim: "x", sourceUrl });

  it("stamps NORD Center of Excellence only when the NORD search returned a page that says so", () => {
    const yes = "https://hospital.example.org/nord";
    expect(secondOpinionClaimType(VEDS)(item(yes, "second_opinion_program"), tracker(yes, "nord-coe", "Named a NORD Rare Disease Center of Excellence"))).toBe("nord_center_of_excellence");
    expect(secondOpinionClaimType(VEDS)(item(yes), tracker(yes, "nord-coe", "A great hospital"))).toBeNull();
    // A model claiming the designation for a page from another search gets a program claim instead.
    expect(secondOpinionClaimType(VEDS)(item(yes, "nord_center_of_excellence"), tracker(yes, "telehealth", "NORD Center of Excellence telehealth for vascular Ehlers-Danlos syndrome"))).toBe("second_opinion_program");
  });

  it("maps RDCRN pages to consortium or registry and UDN only from its own site", () => {
    const consortium = "https://vcrc.rarediseasesnetwork.org/our-consortium";
    const registry = "https://www.rarediseasesnetwork.org/registry";
    expect(rareNetworkClaimType(VEDS)(item(consortium), tracker(consortium, "rdcrn", "consortium studying vascular Ehlers-Danlos syndrome"))).toBe("rdcrn_consortium");
    expect(rareNetworkClaimType(VEDS)(item(registry), tracker(registry, "rdcrn", "contact registry"))).toBe("patient_registry");
    const fakeUdn = "https://udn.example.com/apply";
    expect(rareNetworkClaimType(UNDIAGNOSED)(item(fakeUdn), tracker(fakeUdn, "udn", "apply"))).toBeNull();
    const udn = "https://undiagnosed.hms.harvard.edu/participate/how-to-apply/";
    expect(rareNetworkClaimType(UNDIAGNOSED)(item(udn), tracker(udn, "udn", "how to apply"))).toBe("udn_intake");
  });

  it("drops registries and consortia for a different disease that shares a word", () => {
    const ehe = "https://ehefoundation.example.org/registry";
    const t = tracker(ehe, "registries", "EHE global patient registry for epithelioid hemangioendothelioma, a rare vascular sarcoma");
    expect(rareNetworkClaimType(CASES[0])(item(ehe), t)).toBeNull();
    const consortium = "https://other.rarediseasesnetwork.org/";
    expect(rareNetworkClaimType(VEDS)(item(consortium), tracker(consortium, "rdcrn", "consortium for vasculitis"))).toBeNull();
    // UDN is never stamped for a diagnosed case.
    const udn = "https://undiagnosed.hms.harvard.edu/participate/";
    expect(rareNetworkClaimType(VEDS)(item(udn), tracker(udn, "udn", "apply"))).toBeNull();
  });

  it("fund claims need a foundation host from the fund search", () => {
    const fund = "https://www.healthwellfoundation.org/fund/iga-nephropathy/";
    expect(diseaseFundClaimType(IGG4)(item(fund), tracker(fund, "funds", "IgG4-related disease fund Status Closed"))).toBe("disease_fund");
    const other = "https://funds.example.com/x";
    expect(diseaseFundClaimType(IGG4)(item(other), tracker(other, "funds", "IgG4-related disease Status Open"))).toBeNull();
  });
});

describe("RDCRN Contact Registry rule", () => {
  const at = "2026-10-24T00:00:00.000Z";
  const reg = { claimType: "patient_registry", claim: "RDCRN Contact Registry", sourceUrl: "https://www.rarediseasesnetwork.org/registry", sourceKind: "exa" as const, fetchedAt: at };
  const org = { kind: "organization" as const, id: "org:rdcrn-cr", name: "RDCRN Contact Registry", organizationKind: "registry" as const, evidenceRefs: [reg.sourceUrl] };
  it("drops the Contact Registry when no consortium for the disease was kept", () => {
    const out = keepContactRegistry({ status: "ok", records: [org], evidence: [reg] }, VEDS);
    expect(out.status === "ok" && out.records).toEqual([]);
  });
  it("keeps it beside a consortium, and always for an undiagnosed case", () => {
    const cons = { ...reg, claimType: "rdcrn_consortium", sourceUrl: "https://x.rarediseasesnetwork.org/" };
    const consOrg = { ...org, id: "org:x", evidenceRefs: [cons.sourceUrl] };
    const both = keepContactRegistry({ status: "ok", records: [org, consOrg], evidence: [reg, cons] }, VEDS);
    expect(both.status === "ok" && both.records).toHaveLength(2);
    const undiagnosed = keepContactRegistry({ status: "ok", records: [org], evidence: [reg] }, UNDIAGNOSED);
    expect(undiagnosed.status === "ok" && undiagnosed.records).toHaveLength(1);
  });
});

describe("clean nothing-found and budgets", () => {
  it("an empty search is a clean ok with no records", async () => {
    const empty: ExaPort = { search: async () => [] };
    const ports = { ...createFixturePorts(), exaDirectory: empty };
    const result = await researchRegistry.disease_funds.run(CASES[2], context(ports));
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.records).toHaveLength(0);
  });

  it("a failing source is an error result, not a throw", async () => {
    const broken: ExaPort = { search: async () => { throw new Error("exa down"); } };
    const result = await researchRegistry.rare_network.run(CASES[1], context({ ...createFixturePorts(), exaDirectory: broken }));
    expect(result).toEqual({ status: "error", message: "exa down" });
  });

  it("withBudget ends a hung agent as an error", async () => {
    vi.useFakeTimers();
    const run = withBudget(() => new Promise(() => {}), 1000);
    const pending = run(CASES[0], context());
    await vi.advanceTimersByTimeAsync(1001);
    await expect(pending).resolves.toEqual({ status: "error", message: "timed out after 1000ms" });
    vi.useRealTimers();
  });

  it("an undiagnosed case seeds the Undiagnosed Diseases Network search and never a disease query", async () => {
    const queries: Array<{ query: string; includeDomains?: string[] }> = [];
    const spy: ExaPort = { search: async (i) => { queries.push(i); return []; } };
    await researchRegistry.rare_network.run({ diseaseName: "Undiagnosed condition", undiagnosed: true, goals: ["second_opinion"] }, context({ ...createFixturePorts(), exaDirectory: spy }));
    expect(queries.some((q) => q.includeDomains?.includes("undiagnosed.hms.harvard.edu"))).toBe(true);
    expect(queries.every((q) => !/Undiagnosed condition/.test(q.query))).toBe(true);
  });
});
