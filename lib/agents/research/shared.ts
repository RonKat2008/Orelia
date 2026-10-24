import { z, type ZodObject, type ZodRawShape } from "zod";
import { HAIKU } from "@/lib/agents/models";
import { buildSystemPrompt } from "@/lib/agents/prompts/common";
import { runAgent, type AgentTool } from "@/lib/agents/runtime";
import {
  researchResultSchema,
  resourceSchema,
  type AgentName,
  type CaseInput,
  type Evidence,
  type ExpertProfile,
  type Resource,
  type TrialRegistry,
  type ResearchResult,
  type SourceKind,
} from "@/lib/contracts";
import type { SourcePorts } from "./source-ports";
import type { ResearchContext } from "./types";

type OrganizationKind = NonNullable<Extract<Resource, { kind: "organization" }>["organizationKind"]>;

/**
 * What the model is allowed to say about evidence: a claim and the URL a tool returned. The source kind and
 * fetch time are stamped by code from the tool call that produced the URL (HARD RULE 2), never by the model.
 */
export const modelEvidenceSchema = z.object({
  /** Optional handle so a record can cite this specific claim instead of every claim at the same URL. */
  id: z.string().min(1).optional(),
  claimType: z.string().min(1),
  claim: z.string().min(1),
  sourceUrl: z.url(),
});

export const researchOutputSchema = z.object({
  records: z.array(resourceSchema),
  evidence: z.array(modelEvidenceSchema),
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

const URL_PATTERN = /^https?:\/\//i;

const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, "");

/** Records every URL, NCT id and unique NPI that tool handlers returned during ONE agent run. */
export class ProvenanceTracker {
  private readonly urls = new Map<string, { kind: SourceKind; fetchedAt: string }>();
  private readonly nctIds = new Set<string>();
  private readonly verifiedNpis = new Set<string>();
  private readonly trialFacts = new Map<string, TrialRegistry>();
  private readonly authorFacts = new Map<string, ExpertProfile>();
  private corpus = "";

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Walk a tool payload, remembering every URL string and indexing all text for credential checks. */
  collect(kind: SourceKind, payload: unknown): void {
    const fetchedAt = this.now().toISOString();
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        this.corpus += `\n${value.toLowerCase()}`;
        if (URL_PATTERN.test(value) && !this.urls.has(value)) this.urls.set(value, { kind, fetchedAt });
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(payload);
  }

  allowNctId(nctId: string): void {
    this.nctIds.add(nctId);
  }

  /** Remember registry facts a tool returned for a trial; also allows the NCT id. */
  rememberTrial(nctId: string, registry: TrialRegistry): void {
    this.nctIds.add(nctId);
    this.trialFacts.set(nctId, registry);
  }

  trialRegistry(nctId: string): TrialRegistry | undefined {
    return this.trialFacts.get(nctId);
  }

  rememberAuthor(name: string, profile: ExpertProfile): void {
    this.authorFacts.set(nameKey(name), profile);
  }

  authorProfile(name: string): ExpertProfile | undefined {
    return this.authorFacts.get(nameKey(name));
  }

  allowVerifiedNpi(npi: string): void {
    this.verifiedNpis.add(npi);
  }

  sourceFor(url: string): { kind: SourceKind; fetchedAt: string } | undefined {
    return this.urls.get(url);
  }

  hasNctId(nctId: string): boolean {
    return this.nctIds.has(nctId);
  }

  hasVerifiedNpi(npi: string): boolean {
    return this.verifiedNpis.has(npi);
  }

  mentions(text: string): boolean {
    return this.corpus.includes(text.toLowerCase());
  }
}

export interface FinalizeRules {
  allowedKinds: ReadonlyArray<Resource["kind"]>;
  /** For organization agents: the only organizationKind values this agent may emit. */
  organizationKinds?: ReadonlyArray<OrganizationKind>;
  /** If set, evidence must come from a tool of one of these source kinds (e.g. identity cites only NPPES). */
  sourceKinds?: ReadonlyArray<SourceKind>;
}

/**
 * Enforce provenance after the model returns. Evidence whose URL no tool returned is dropped; records lose any
 * identifier (NPI, NCT id, URL, credential) no tool returned; records left without evidence are dropped.
 * `evidenceRefs` on records are the sourceUrl strings of their evidence (Evidence has no id in the contract).
 */
export function finalizeOutput(
  raw: ResearchOutput,
  tracker: ProvenanceTracker,
  rules: FinalizeRules,
): { records: Resource[]; evidence: Evidence[] } {
  const evidenceByUrl = new Map<string, Evidence[]>();
  const evidenceById = new Map<string, Evidence>();
  const seenClaims = new Set<string>();
  for (const item of raw.evidence) {
    const source = tracker.sourceFor(item.sourceUrl);
    if (!source) continue;
    if (rules.sourceKinds && !rules.sourceKinds.includes(source.kind)) continue;
    const key = `${item.sourceUrl}\u0000${item.claim}`;
    if (seenClaims.has(key)) continue;
    seenClaims.add(key);
    const stamped: Evidence = {
      ...(item.id && !evidenceById.has(item.id) ? { id: item.id } : {}),
      claimType: item.claimType,
      claim: item.claim,
      sourceUrl: item.sourceUrl,
      sourceKind: source.kind,
      fetchedAt: source.fetchedAt,
    };
    if (stamped.id) evidenceById.set(stamped.id, stamped);
    evidenceByUrl.set(item.sourceUrl, [...(evidenceByUrl.get(item.sourceUrl) ?? []), stamped]);
  }

  // A ref is an evidence id (cites exactly that claim) or a sourceUrl (cites every claim at that URL).
  const resolve = (ref: string): Evidence[] => {
    const byId = evidenceById.get(ref);
    return byId ? [byId] : (evidenceByUrl.get(ref) ?? []);
  };

  const records: Resource[] = [];
  const seenIds = new Set<string>();
  const referenced = new Set<Evidence>();
  for (const candidate of raw.records) {
    if (!rules.allowedKinds.includes(candidate.kind) || seenIds.has(candidate.id)) continue;
    const refs = [...new Set(candidate.evidenceRefs.filter((ref) => resolve(ref).length > 0))];
    if (refs.length === 0) continue;
    const sanitized = sanitizeRecord(candidate, refs, tracker, rules);
    if (!sanitized) continue;
    seenIds.add(sanitized.id);
    records.push(sanitized);
    for (const ref of refs) resolve(ref).forEach((e) => referenced.add(e));
  }

  const evidence = [...evidenceByUrl.values()].flat().filter((e) => referenced.has(e));
  return { records, evidence };
}

function sanitizeRecord(
  record: Resource,
  evidenceRefs: string[],
  tracker: ProvenanceTracker,
  rules: FinalizeRules,
): Resource | null {
  switch (record.kind) {
    case "expert": {
      const npi = record.npi && tracker.hasVerifiedNpi(record.npi) ? record.npi : null;
      const credentials =
        record.credentials && tracker.mentions(record.credentials) ? record.credentials : undefined;
      // verified / profile are stamped from tool output only; anything the model supplied is discarded.
      const { credentials: _c, verified: _v, profile: _p, ...rest } = record;
      void _c;
      void _v;
      void _p;
      const profile = tracker.authorProfile(record.name);
      return {
        ...rest,
        ...(credentials ? { credentials } : {}),
        npi,
        ...(npi ? { verified: true } : {}),
        ...(profile ? { profile } : {}),
        evidenceRefs,
      };
    }
    case "trial": {
      if (!tracker.hasNctId(record.nctId)) return null;
      const { registry: _r, ...rest } = record;
      void _r;
      const registry = tracker.trialRegistry(record.nctId);
      return { ...rest, ...(registry ? { registry } : {}), evidenceRefs };
    }
    case "organization": {
      if (rules.organizationKinds && !(record.organizationKind && rules.organizationKinds.includes(record.organizationKind))) {
        return null;
      }
      const { url, ...rest } = record;
      return { ...rest, ...(url && tracker.sourceFor(url) ? { url } : {}), evidenceRefs };
    }
    case "institution":
      return { ...record, evidenceRefs };
  }
}

/** Build a tool whose every return value is recorded by the tracker before the model sees it. */
export function trackedTool<S extends ZodObject<ZodRawShape>>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  kind: SourceKind;
  tracker: ProvenanceTracker;
  run: (input: z.infer<S>) => Promise<unknown>;
}): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    handler: async (input: never) => {
      const output = await spec.run(input as z.infer<S>);
      spec.tracker.collect(spec.kind, output);
      return output;
    },
  };
}

export type ToolCaller = (name: string, input: Record<string, unknown>) => Promise<unknown>;

const DEMO_SLUGS: Array<[RegExp, string]> = [
  [/epithelioid sarcoma/i, "epithelioid-sarcoma"],
  [/ehlers/i, "vascular-eds"],
  [/igg4/i, "igg4-related-disease"],
];

/** Stable fixture stem for a case, e.g. fixtures/llm/<agent>/<slug>.json. */
export function caseSlug(c: Pick<CaseInput, "diseaseName">): string {
  for (const [pattern, slug] of DEMO_SLUGS) if (pattern.test(c.diseaseName)) return slug;
  return c.diseaseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Minimum-necessary view of the case for research prompts (no insurer or plan ids). */
export function caseBrief(c: CaseInput): Record<string, unknown> {
  return {
    diseaseName: c.diseaseName,
    subtype: c.subtype,
    homeState: c.homeState,
    travelLimitMiles: c.travelLimitMiles,
    goals: c.goals,
  };
}

export interface ResearchAgentSpec {
  name: AgentName;
  instructions: string;
  rules: FinalizeRules;
  makeTools(ports: SourcePorts, tracker: ProvenanceTracker): AgentTool[];
  /** Deterministic first pass through the same tracked tools, so provenance exists even when the model is replayed. */
  seed(call: ToolCaller, c: CaseInput): Promise<unknown>;
}

const MAX_SEED_CHARS = 24_000;

export function runResearch(spec: ResearchAgentSpec) {
  return async (c: CaseInput, ctx: ResearchContext): Promise<ResearchResult> => {
    try {
      const tracker = new ProvenanceTracker();
      const tools = spec.makeTools(ctx.ports, tracker);
      const call: ToolCaller = async (name, input) => {
        const tool = tools.find((t) => t.name === name);
        if (!tool) throw new Error(`Unknown tool ${name}`);
        return tool.handler(tool.inputSchema.parse(input) as never);
      };
      const seeded = JSON.stringify(await spec.seed(call, c)).slice(0, MAX_SEED_CHARS);
      const prompt = [
        `Case: ${JSON.stringify(caseBrief(c))}`,
        `Initial tool results (already fetched; call tools again only if you need more):\n${seeded}`,
        `Return ONLY JSON: {"records": Resource[], "evidence": {"claimType": string, "claim": string, "sourceUrl": string}[]}.`,
        `Every record's evidenceRefs must be the "id" (if you gave the item one) or the sourceUrl of evidence items you return.`,
      ].join("\n\n");

      const raw = await runAgent({
        name: spec.name,
        model: HAIKU,
        system: buildSystemPrompt(spec.instructions),
        prompt,
        tools,
        output: researchOutputSchema,
        caseId: ctx.caseId,
        store: ctx.store,
        offlineKey: caseSlug(c),
      });
      const { records, evidence } = finalizeOutput(raw, tracker, spec.rules);
      return researchResultSchema.parse({ status: "ok", records, evidence });
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function notImplemented(name: AgentName) {
  return {
    name,
    model: HAIKU,
    run: async (): Promise<ResearchResult> => ({ status: "not_implemented" }),
  } as const;
}
