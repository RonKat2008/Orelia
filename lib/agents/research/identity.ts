import { mentionStrength } from "@/lib/agents/relevance";
import { z } from "zod";
import { matchIdentity, type IdentityAssessment } from "@/lib/identity/match";
import type { NppesProvider as RawProvider } from "@/lib/sources/nppes";
import { HAIKU } from "@/lib/agents/models";
import type { AgentTool } from "@/lib/agents/runtime";
import { pubmedAuthorsTool } from "./pubmed-tool";
import { runResearch, trackedTool, type ProvenanceTracker } from "./shared";
import type { NppesPort, PubmedAuthorHit } from "./source-ports";
import type { ResearchAgent } from "./types";

export const nppesProviderUrl = (npi: string): string =>
  `https://npiregistry.cms.hhs.gov/provider-view/${npi}`;

const SEED_AUTHORS = 6;

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");
const firstToken = (s: string): string => normalize(s.trim().split(/\s+/)[0] ?? "");
const middleInitial = (name?: string): string => {
  const token = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return token ? token[0]!.toLowerCase() : "";
};

/**
 * PubMed often lists the same person once as "Jerad" and again as "Jerad M".
 * Those rows are one author. Conflicting middle initials stay ambiguous so two namesakes are not verified as one NPI.
 */
function mergedAuthor(hits: readonly PubmedAuthorHit[], first: string, last: string): {
  ambiguous: boolean;
  papers: PubmedAuthorHit["papers"];
  author: { firstName: string; lastName: string; middleName?: string; affiliation?: string; affiliations?: string[] };
} {
  const initials = new Set(hits.map((h) => middleInitial(h.middleName)).filter(Boolean));
  const ambiguous = initials.size > 1;
  const papers = [...new Map(hits.flatMap((h) => h.papers.map((p) => [p.pmid, p] as const))).values()];
  const affiliations = [...new Set(hits.flatMap((h) => [...(h.affiliations ?? []), ...(h.affiliation ? [h.affiliation] : [])]))];
  const middleName = hits.find((h) => h.middleName)?.middleName;
  return {
    ambiguous,
    papers,
    author: {
      firstName: hits[0]?.firstName ?? first,
      lastName: hits[0]?.lastName ?? last,
      ...(!ambiguous && middleName ? { middleName } : {}),
      ...(affiliations.length ? { affiliation: affiliations[0], affiliations } : {}),
    },
  };
}

const inputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  state: z.string().length(2).optional().describe("Two-letter state, if known from the author's affiliation"),
});

/**
 * NPPES lookup. Verification requires deterministic name, clinical taxonomy and affiliation corroboration.
 */
function lookupNpiTool(nppes: NppesPort, tracker: ProvenanceTracker, assess: (first: string, last: string, providers: RawProvider[], truncated: boolean) => Promise<IdentityAssessment>): AgentTool {
  return trackedTool({
    name: "lookup_npi",
    description:
      "Look up a person in the NPPES NPI Registry by name (and state). Reports how many providers match the name exactly. Only a corroborated active clinician with a disease-relevant taxonomy and matching publication practice city/state counts as verified.",
    inputSchema,
    kind: "nppes",
    tracker,
    run: async ({ firstName, lastName, state }) => {
      const result = await nppes.lookup({ firstName, lastName, state });
      const exact = result.providers.filter(
        (p) => firstToken(p.firstName) === firstToken(firstName) && normalize(p.lastName) === normalize(lastName),
      );
      const assessment = await assess(firstName, lastName, result.providers.flatMap((p) => p.raw ? [p.raw] : []), result.truncated ?? true);
      const verified = assessment.verified;
      if (assessment.npi) tracker.allowVerifiedNpi(assessment.npi);
      return {
        query: { firstName, lastName, state },
        searchUrl: result.searchUrl,
        providersReturned: result.providers.length,
        exactNameMatches: exact.length,
        ...assessment,
        verified,
        matches: exact.filter((p) => !verified || p.npi === assessment.npi).slice(0, 5).map((p) => ({
          npi: p.npi,
          name: `${p.firstName} ${p.lastName}`,
          credential: p.credential,
          taxonomy: p.taxonomy,
          city: p.city,
          state: p.state,
          sourceUrl: nppesProviderUrl(p.npi),
        })),
      };
    },
  });
}

const INSTRUCTIONS = `ROLE: Identity agent. For people who publish on the patient's disease, check the NPPES NPI Registry and report whether each can be uniquely identified.

For each author you looked up, output one record of kind "expert": {"kind":"expert","id":...,"name":"First Last","npi":...,"credentials"?:...,"specialty"?:...,"evidenceRefs":[...]}.
- If the lookup says verified=true: npi = that match's npi, id = "npi:<npi>", credentials and specialty only as returned (credential, taxonomy), evidence claimType "identity_verified" with sourceUrl = the match's sourceUrl. The claim names the NPI, taxonomy and city/state returned.
- If verified=false (including rejected taxonomies, missing affiliation corroboration, ambiguous names or incomplete results): NEVER guess. npi = null, id = "expert:<first>-<last lowercased>", no credentials. One evidence item, claimType "identity_unverified", sourceUrl = the lookup's searchUrl, claim saying how many exact name matches the registry returned and that identity was not confirmed.
- Never combine two registry entries, never pick one of several, never use an NPI the tool did not mark verified.`;

export const identityAgent: ResearchAgent = {
  name: "identity",
  model: HAIKU,
  run: async (c, ctx) => {
    const assessments = new Map<string, { verdict: IdentityAssessment; provider?: RawProvider; papers: PubmedAuthorHit["papers"]; name?: string }>();
    const key = (first: string, last: string) => `${firstToken(first)}|${normalize(last)}`;
    const authors = await ctx.ports.pubmed.searchAuthors({ disease: c.diseaseName, limit: 15 });
    const assess = async (first: string, last: string, providers: RawProvider[], truncated: boolean) => {
      const hits = authors.filter((a) => key(a.firstName, a.lastName) === key(first, last));
      const merged = mergedAuthor(hits, first, last);
      const verdict = matchIdentity(merged.author, providers, c.diseaseName, { truncated: truncated || merged.ambiguous });
      const name = hits.slice().sort((a, b) => b.paperCount - a.paperCount)[0]?.name;
      assessments.set(key(first, last), { verdict, papers: merged.papers, ...(name ? { name } : {}), provider: providers.find((p) => String(p.number) === verdict.npi) });
      return verdict;
    };
    const result = await runResearch({
      name: "identity",
      instructions: INSTRUCTIONS,
      rules: { allowedKinds: ["expert"], sourceKinds: ["nppes"] },
      makeTools: (ports, tracker) => [
        pubmedAuthorsTool(ports.pubmed, tracker),
        lookupNpiTool(ports.nppes, tracker, assess),
      ],
      seed: async (call, c) => {
        const found = (await call("search_pubmed_authors", { disease: c.diseaseName, limit: SEED_AUTHORS })) as {
          authors: Array<{ firstName: string; lastName: string; state?: string }>;
        };
        const lookups = [];
        for (const a of found.authors) {
          lookups.push(
            await call("lookup_npi", {
              firstName: a.firstName,
              lastName: a.lastName,
              ...(a.state ? { state: a.state } : {}),
            }),
          );
        }
        return { authors: found.authors.map((a) => `${a.firstName} ${a.lastName}`), lookups };
      },
    })(c, ctx);
    if (result.status !== "ok") return result;
    // Code replaces model identity prose and binds the selected NPI to the publication author.
    const evidence: typeof result.evidence = [];
    const records = result.records.map((r) => {
      if (r.kind !== "expert") return r;
      const parts = r.name.trim().split(/\s+/);
      const item = assessments.get(key(parts[0] ?? "", parts.at(-1) ?? ""));
      const verdict = item?.verdict;
      const papers = item?.papers.filter((p) => mentionStrength(p.title, c) === "exact") ?? [];
      const profile = { ...r.profile, paperCount: new Set(papers.map((p) => p.pmid)).size, recentPaperCount: new Set(papers.filter((p) => p.year && p.year >= new Date().getFullYear() - 5).map((p) => p.pmid)).size };
      const npi = verdict?.verified ? verdict.npi : null;
      const refs = r.evidenceRefs.filter((ref) => result.evidence.some((e) => e.sourceUrl === ref || e.id === ref));
      const source = result.evidence.find((e) => refs.includes(e.sourceUrl) || !!e.id && refs.includes(e.id));
      if (!source) return { ...r, npi: null, verified: false, credentials: undefined, specialty: undefined };
      const stamped = { ...source, id: undefined, claimType: npi ? "identity_verified" : "identity_unverified", claim: `${verdict?.summary ?? "NPI rejected: no corroborated author"}. ${(verdict?.reasons ?? []).join("; ")}`, sourceUrl: npi ? nppesProviderUrl(npi) : source.sourceUrl };
      evidence.push(stamped);
      return { ...r, name: item?.name ?? r.name, profile, npi, verified: !!npi, credentials: npi && typeof item?.provider?.basic.credential === "string" ? item.provider.basic.credential : undefined, specialty: npi ? item?.provider?.taxonomies?.find((t) => t.primary)?.desc ?? undefined : undefined, evidenceRefs: [stamped.sourceUrl] };
    });
    return { status: "ok", records, evidence };
  },
};
