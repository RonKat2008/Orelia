import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Evidence, ResearchResult, Resource } from "@/lib/contracts";
import { createMergeProposer, proposalsSchema } from "@/lib/agents/proposer";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { deterministicUuid, supportedMerge, verify, verifyWithProposals, type VerifiedRecord } from "@/lib/agents/verifier";

const evidence = (id: string, facts: Record<string, string>): Evidence => ({
  id, claimType: "identity", claim: JSON.stringify(facts), sourceUrl: `https://sources.example/${id}`,
  sourceKind: "exa", fetchedAt: "2026-01-01T00:00:00.000Z",
});
const org = (id: string, url: string): Resource => ({ kind: "organization", id, name: id, url, evidenceRefs: ["0"] });
const institution = (id: string, name: string, city = "Boston", state = "MA"): Resource => ({ kind: "institution", id, name, city, state, evidenceRefs: ["0"] });
const result = (record: Resource, ev: Evidence): ResearchResult => ({ status: "ok", records: [record], evidence: [ev] });
const pair = [result(org("a", "https://fund.example/advocacy"), evidence("a", {})), result(org("b", "http://www.fund.example/aid/"), evidence("b", {}))];
const proposePair = async (kept: readonly VerifiedRecord[]) => ({ merges: [{ keys: [kept[0]!.key, kept[1]!.key] as [string, string], reason: "same resource" }], conflicts: [] });

afterEach(() => vi.unstubAllEnvs());

describe("deterministic proposal gate", () => {
  it("accepts normalized domain matches and unions the exact existing evidence IDs", async () => {
    const base = verify(pair);
    const out = await verifyWithProposals(pair, proposePair);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidence).toEqual(base.kept.flatMap((k) => k.evidence));
    expect(out.kept[0]!.resource.evidenceRefs).toEqual(out.kept[0]!.evidence.map((e) => e.id));
    expect(out.kept[0]!.resource).toEqual({ ...base.kept[0]!.resource, evidenceRefs: out.kept[0]!.resource.evidenceRefs });
  });

  it("rejects unsupported same-kind proposals", async () => {
    const input = [pair[0]!, result(org("other", "https://unrelated.example"), evidence("b", {}))];
    expect((await verifyWithProposals(input, proposePair)).kept).toHaveLength(2);
  });

  it("accepts cited structured evidence from both records", async () => {
    const input = [result(institution("a", "Harbor Center"), evidence("a", { domain: "harbor.example" })), result(institution("b", "Harbor Hospital"), evidence("b", { domain: "www.harbor.example" }))];
    const out = await verifyWithProposals(input, async (kept) => ({
      merges: [{ ...(await proposePair(kept)).merges[0]!, evidenceIds: kept.flatMap((r) => r.evidence.map((e) => e.id)) }], conflicts: [],
    }));
    expect(out.kept).toHaveLength(1);
  });

  it.each(["one-sided", "invented", "narrative"])("rejects %s evidence support", async (mode) => {
    const input = [result(institution("a", "Harbor Center"), evidence("a", { domain: "harbor.example" })), result(institution("b", "Harbor Hospital"), evidence("b", { domain: "harbor.example" }))];
    if (mode === "narrative" && input[0]!.status === "ok" && input[1]!.status === "ok") {
      input[0]!.evidence[0]!.claim = input[1]!.evidence[0]!.claim = "These are the same center";
    }
    const out = await verifyWithProposals(input, async (kept) => ({
      merges: [{ ...(await proposePair(kept)).merges[0]!, evidenceIds: mode === "invented" ? ["invented"] : kept.slice(0, mode === "one-sided" ? 1 : 2).flatMap((r) => r.evidence.map((e) => e.id)) }], conflicts: [],
    }));
    expect(out.kept).toHaveLength(2);
  });

  it("never joins different NPIs even when cited domains match", async () => {
    const input = ["123", "456"].map((npi, i) => result({ kind: "expert", id: `${i}`, name: `Person ${i}`, npi, verified: true, evidenceRefs: ["0"] }, evidence(`${i}`, { domain: "hospital.example" })));
    const out = await verifyWithProposals(input, async (kept) => ({ merges: [{ ...(await proposePair(kept)).merges[0]!, evidenceIds: kept.flatMap((r) => r.evidence.map((e) => e.id)) }], conflicts: [] }));
    expect(out.kept).toHaveLength(2);
  });

  it("surfaces conflicting phones for the same NPI after base deduplication", async () => {
    const input = ["+1 (617) 555-0100", "+1 (617) 555-0200"].map((phone, i) => result({ kind: "expert", id: `${i}`, name: "Alex Rivera", npi: "1234567890", evidenceRefs: ["0"] }, evidence(`${i}`, { npi: "1234567890", phone })));
    const out = await verifyWithProposals(input, async () => ({ merges: [], conflicts: [] }));
    expect(out.kept).toHaveLength(1);
    expect(out.conflicts).toContainEqual(expect.objectContaining({ reason: "Conflicting structured phone values", values: ["+1 (617) 555-0100", "+1 (617) 555-0200"] }));
  });

  it("ignores unknown keys and cross-kind merges", async () => {
    const input = [pair[0]!, result(institution("b", "A hospital"), evidence("b", {}))];
    const out = await verifyWithProposals(input, async (kept) => ({ merges: [...(await proposePair(kept)).merges, { keys: ["missing", kept[0]!.key], reason: "invented" }], conflicts: [{ key: "missing", reason: "invented" }] }));
    expect(out.kept).toHaveLength(2);
    expect(out.conflicts).toEqual([]);
  });
});

// Replay uses the exact evidence IDs assigned by deterministic verification.
const fixtureRecord = (key: string, resource: Resource, ev: Evidence): VerifiedRecord => ({ key, resource, evidence: [{ ...ev, id: deterministicUuid(`${key}|${ev.sourceUrl}|${ev.claimType}|${ev.claim}`) }] });
const fixtureCases = [
  { slug: "epithelioid-sarcoma", records: [
    fixtureRecord("institution:name:harbor sarcoma center", institution("a", "Harbor Sarcoma Center"), evidence("sarcoma-centers-domain", { domain: "harbor.example" })),
    fixtureRecord("institution:name:harbor cancer center", institution("b", "Harbor Cancer Center"), evidence("sarcoma-contact-domain", { domain: "harbor.example" })),
  ] },
  { slug: "vascular-eds", records: [
    fixtureRecord("expert:name:alex rivera", { kind: "expert", id: "a", name: "Alex Rivera", evidenceRefs: [] }, evidence("eds-literature-npi", { npi: "1234567890" })),
    fixtureRecord("expert:npi:1234567890", { kind: "expert", id: "b", name: "A Rivera", npi: "1234567890", verified: true, evidenceRefs: [] }, evidence("eds-identity-npi", { npi: "1234567890" })),
  ] },
  { slug: "igg4-rd", records: [
    fixtureRecord("organization:url:rare-support.example/advocacy", org("a", "https://rare-support.example/advocacy"), evidence("advocacy", {})),
    fixtureRecord("organization:url:rare-support.example/aid", org("b", "https://rare-support.example/aid"), evidence("aid", {})),
  ] },
];

describe("proposer factory", () => {
  it.each(fixtureCases)("replays $slug with runtime bookkeeping", async ({ slug, records }) => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const store = new MemoryRunStore();
    const client = { messages: { create: vi.fn() } };
    const proposals = await createMergeProposer({ caseId: "case", offlineKey: slug, store, client })(records);
    expect(proposalsSchema.safeParse(proposals).success).toBe(true);
    expect(proposals.merges).toHaveLength(1);
    expect(supportedMerge(records[0]!, records[1]!, proposals.merges[0]!)).toBe(true);
    const input = records.map((r) => result({ ...r.resource, evidenceRefs: ["0"] }, r.evidence[0]!));
    const verified = await verifyWithProposals(input, createMergeProposer({ caseId: "full", offlineKey: slug, store }));
    expect(verified.kept).toHaveLength(1);
    expect(verified.kept[0]!.evidence).toHaveLength(2);
    expect(client.messages.create).not.toHaveBeenCalled();
    expect((await store.listByCase("case"))[0]).toMatchObject({ agent: "proposer", status: "done" });
  });

  it("replays deterministic-ID fixtures through the full verifier", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const out = await verifyWithProposals(pair, createMergeProposer({ caseId: "case", offlineKey: "igg4-rd", store: new MemoryRunStore() }));
    // Unrelated fixture keys must not merge the current input.
    expect(out.kept).toHaveLength(2);
  });

  it("selects the verifier model role and passes only verified records to a live client", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "0");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("WAYFINDER_RECORD_LLM", "");
    vi.stubEnv("WAYFINDER_MODEL_VERIFIER", "test-opus-verifier");
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: '{"merges":[],"conflicts":[]}' }] } as Anthropic.Message);
    const output = await createMergeProposer({ caseId: "case", offlineKey: "unused", store: new MemoryRunStore(), client: { messages: { create } } })(fixtureCases[0]!.records);
    expect(output).toEqual({ merges: [], conflicts: [] });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({ model: "test-opus-verifier" });
    expect(create.mock.calls[0]![0].messages[0].content).toContain("institution:name:harbor sarcoma center");
    expect(create.mock.calls[0]![0].tools).toBeUndefined();
  });

  it("returns no proposals on a replay failure and records the failure", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const store = new MemoryRunStore();
    const output = await createMergeProposer({ caseId: "case", offlineKey: "missing", store })(fixtureCases[0]!.records);
    expect(output).toEqual({ merges: [], conflicts: [] });
    expect((await store.listByCase("case"))[0]!.status).toBe("failed");
  });

  it("rejects model-supplied replacement fields", () => {
    expect(proposalsSchema.safeParse({ merges: [{ keys: ["a", "b"], reason: "same", resource: { name: "invented" } }], conflicts: [] }).success).toBe(false);
  });
});
