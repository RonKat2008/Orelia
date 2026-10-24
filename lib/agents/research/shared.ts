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
import { contactPointEvidence, isContactPointClaimType, type ContactPoint } from "@/lib/contact-finder/contact-points";
import { webFormEvidence, type WebFormPoint } from "@/lib/plan/contact-points";
import { checkClaimGrounding } from "./grounding";
import { isAffiliationClaimType } from "@/lib/identity/affiliation-evidence";
import { isPaperClaimType } from "@/lib/identity/paper-evidence";
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

/** Literal delimiters used by lib/agents/research/untrusted.ts (task #31) around third-party page text. */
const UNTRUSTED_BLOCK = /<untrusted_web_content[^>]*>[\s\S]*?(?:<\/untrusted_web_content>|$)/gi;

/**
 * Text a credential check may rely on: everything except third-party page text inside <untrusted_web_content>
 * blocks (an unclosed block runs to the end of the string), so a malicious page cannot make a credential count as
 * "mentioned". Structured registry fields (PubMed, NPPES, CT.gov) are never wrapped and stay in.
 */
export function withoutUntrustedBlocks(text: string): string {
  return text.replace(UNTRUSTED_BLOCK, " ");
}

/** The scalar (non-object) fields of an enclosing object, e.g. an author's name and paper counts. */
const scalarText = (value: object): string =>
  JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, v]) => v === null || typeof v !== "object")));

const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, "");

/** Records every URL, NCT id and unique NPI that tool handlers returned during ONE agent run. */
export class ProvenanceTracker {
  private readonly urls = new Map<string, { kind: SourceKind; fetchedAt: string }>();
  private readonly nctIds = new Set<string>();
  private readonly verifiedNpis = new Set<string>();
  private readonly trialFacts = new Map<string, TrialRegistry>();
  private readonly authorFacts = new Map<string, ExpertProfile>();
  private readonly authorPapers = new Map<string, { name: string; disease: string; pmids: Set<string> }>();
  private readonly recordTexts = new Map<string, string>();
  private readonly contactPoints = new Map<string, ContactPoint[]>();
  private readonly webForms = new Map<string, WebFormPoint[]>();
  private readonly paperAffiliations = new Map<string, string>();
  private readonly papers = new Map<string, { title: string; journal?: string; year?: number }>();
  private corpus = "";

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Walk a tool payload, remembering every URL string and indexing all text for credential checks. Each URL also
   * gets its record text: the full object that carried it plus the scalar fields of every enclosing object, which
   * is what a claim citing that URL may state (see grounding.ts).
   */
  collect(kind: SourceKind, payload: unknown): void {
    const fetchedAt = this.now().toISOString();
    // `stack` holds the enclosing objects, innermost last.
    const walk = (value: unknown, stack: object[]): void => {
      if (typeof value === "string") {
        this.corpus += `\n${withoutUntrustedBlocks(value).toLowerCase()}`;
        if (URL_PATTERN.test(value)) {
          if (!this.urls.has(value)) this.urls.set(value, { kind, fetchedAt });
          const holder = stack.at(-1);
          const text = [holder ? JSON.stringify(holder) : value, ...stack.slice(0, -1).map(scalarText)].join("\n");
          this.recordTexts.set(value, `${this.recordTexts.get(value) ?? ""}\n${text.toLowerCase()}`);
        }
      } else if (Array.isArray(value)) value.forEach((v) => walk(v, stack));
      else if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, [...stack, value]));
    };
    walk(payload, []);
  }

  /** Remember contact points a tool handler derived from structured output (intake doors, registry contacts). */
  rememberContactPoints(points: readonly ContactPoint[]): void {
    for (const cp of points) {
      const known = this.contactPoints.get(cp.sourceUrl) ?? [];
      if (!known.some((k) => k.address === cp.address && k.origin === cp.origin)) this.contactPoints.set(cp.sourceUrl, [...known, cp]);
    }
  }

  contactPointsFor(url: string): ContactPoint[] {
    return this.contactPoints.get(url) ?? [];
  }

  /** Remember online forms the deterministic detector found on fetched pages (lib/contact-finder/web-forms). */
  rememberWebForms(forms: readonly WebFormPoint[]): void {
    for (const wf of forms) {
      const known = this.webForms.get(wf.sourceUrl) ?? [];
      if (!known.some((k) => k.url === wf.url && k.origin === wf.origin)) this.webForms.set(wf.sourceUrl, [...known, wf]);
    }
  }

  webFormsFor(url: string): WebFormPoint[] {
    return this.webForms.get(url) ?? [];
  }

  /** Lowercased text of the tool record(s) that carried this URL; empty when no tool returned it. */
  recordText(url: string): string {
    return this.recordTexts.get(url) ?? "";
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

  /** Remember which papers a tool listed for an author, so publication claims can be rebuilt from the record. */
  rememberAuthorPapers(name: string, disease: string, pmids: readonly string[]): void {
    const key = nameKey(name);
    const known = this.authorPapers.get(key);
    this.authorPapers.set(key, { name, disease, pmids: new Set([...(known?.pmids ?? []), ...pmids]) });
  }

  /** Tool-returned authors of a PMID (with the disease the search was for). */
  authorsOf(pmid: string): Array<{ name: string; disease: string; profile?: ExpertProfile }> {
    return [...this.authorPapers.entries()]
      .filter(([, a]) => a.pmids.has(pmid))
      .map(([key, a]) => ({ name: a.name, disease: a.disease, profile: this.authorFacts.get(key) }));
  }

  /** The author's affiliation on one paper, exactly as the PubMed tool returned it (raw; sanitize before use). */
  rememberPaperAffiliation(name: string, pmid: string, affiliation: string): void {
    this.paperAffiliations.set(`${nameKey(name)}|${pmid}`, affiliation);
  }

  /** A paper's title / journal / year exactly as the PubMed tool returned them (raw; sanitize before use). */
  rememberPaper(pmid: string, paper: { title: string; journal?: string; year?: number }): void {
    this.papers.set(pmid, paper);
  }

  paperMeta(pmid: string): { title: string; journal?: string; year?: number } | undefined {
    return this.papers.get(pmid);
  }

  paperAffiliation(name: string, pmid: string): string | undefined {
    return this.paperAffiliations.get(`${nameKey(name)}|${pmid}`);
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
  /**
   * If set, replaces the model's claim with deterministic text built from the tool record (null drops the item).
   * Used where the claim is fully determined by tool facts, so no model prose reaches the user at all.
   */
  restateClaim?: (item: ResearchOutput["evidence"][number], tracker: ProvenanceTracker) => string | null;
  /**
   * Code-stamped rows built from tool records for a kept record (e.g. identity.affiliation). Each must carry an id;
   * it is appended to the record's evidenceRefs. Never fed from model prose.
   */
  stampEvidence?: (record: Resource, cited: readonly Evidence[], tracker: ProvenanceTracker) => Evidence[];
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
  onDrop: (item: ResearchOutput["evidence"][number], reason: string) => void = () => {},
): { records: Resource[]; evidence: Evidence[] } {
  const evidenceByUrl = new Map<string, Evidence[]>();
  const evidenceById = new Map<string, Evidence>();
  const seenClaims = new Set<string>();
  for (const item of raw.evidence) {
    const source = tracker.sourceFor(item.sourceUrl);
    if (!source) {
      onDrop(item, "no tool returned this sourceUrl");
      continue;
    }
    if (rules.sourceKinds && !rules.sourceKinds.includes(source.kind)) {
      onDrop(item, `source kind ${source.kind} is not allowed for this agent`);
      continue;
    }
    if (isContactPointClaimType(item.claimType)) {
      onDrop(item, "contact points are stamped from tool output by code, never by a model");
      continue;
    }
    if (isAffiliationClaimType(item.claimType)) {
      onDrop(item, "affiliations are stamped from tool output by code, never by a model");
      continue;
    }
    if (isPaperClaimType(item.claimType)) {
      onDrop(item, "paper citations are stamped from tool output by code, never by a model");
      continue;
    }
    let claim = item.claim;
    if (rules.restateClaim) {
      const restated = rules.restateClaim(item, tracker);
      if (!restated) {
        onDrop(item, "claim could not be rebuilt from the tool record");
        continue;
      }
      claim = restated;
    } else {
      const grounding = checkClaimGrounding(item.claim, tracker.recordText(item.sourceUrl));
      if (!grounding.ok) {
        onDrop(item, grounding.reason);
        continue;
      }
    }
    const key = `${item.sourceUrl}\u0000${claim}`;
    if (seenClaims.has(key)) continue;
    seenClaims.add(key);
    const stamped: Evidence = {
      ...(item.id && !evidenceById.has(item.id) ? { id: item.id } : {}),
      claimType: item.claimType,
      claim,
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
  const contactEvidence = new Map<string, Evidence>();
  for (const candidate of raw.records) {
    if (!rules.allowedKinds.includes(candidate.kind) || seenIds.has(candidate.id)) continue;
    const refs = [...new Set(candidate.evidenceRefs.filter((ref) => resolve(ref).length > 0))];
    if (refs.length === 0) continue;
    const sanitized = sanitizeRecord(candidate, refs, tracker, rules);
    if (!sanitized) continue;
    // Contact points come only from structured tool output for the URLs this record is evidenced by.
    const urls = new Set([...refs.flatMap((ref) => resolve(ref).map((e) => e.sourceUrl)), ...(sanitized.kind === "organization" && sanitized.url ? [sanitized.url] : [])]);
    const contacts = [...urls].flatMap((url) => {
      const source = tracker.sourceFor(url);
      if (!source) return [];
      return [
        ...tracker.contactPointsFor(url).flatMap((cp) => contactPointEvidence(cp, source.fetchedAt) ?? []),
        ...tracker.webFormsFor(url).flatMap((wf) => webFormEvidence(wf, source.fetchedAt) ?? []),
      ];
    });
    const cited = [...new Set(refs.flatMap(resolve))];
    const stamped = (rules.stampEvidence?.(sanitized, cited, tracker) ?? []).filter((e) => !!e.id);
    seenIds.add(sanitized.id);
    records.push({ ...sanitized, evidenceRefs: [...sanitized.evidenceRefs, ...[...contacts, ...stamped].flatMap((e) => (e.id ? [e.id] : []))] });
    for (const ref of refs) resolve(ref).forEach((e) => referenced.add(e));
    for (const e of [...contacts, ...stamped]) if (!contactEvidence.has(e.id ?? "")) contactEvidence.set(e.id ?? "", e);
  }

  const evidence = [...[...evidenceByUrl.values()].flat().filter((e) => referenced.has(e)), ...contactEvidence.values()];
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
