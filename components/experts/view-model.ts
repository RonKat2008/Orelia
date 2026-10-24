import { chainPapers, type ChainVerdict, type ExpertChain, type ExpertTrace, type ReachRoute, type TraceEvidence } from "@/lib/experts/contract";

/** Only http(s) links are ever rendered as anchors. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface SourceLink {
  id: string;
  url: string;
  claim: string;
  fetchedAt: string;
}

/** Resolve evidence ids to rows of the trace. Ids with no row (or no safe URL) are dropped; callers show a gap note. */
export function resolveSources(trace: Pick<ExpertTrace, "evidence">, ids: readonly string[]): { links: SourceLink[]; missing: number } {
  const byId = new Map<string, TraceEvidence>(trace.evidence.map((row) => [row.id, row]));
  const links: SourceLink[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    const url = safeHref(row?.sourceUrl);
    if (row && url) links.push({ id, url, claim: row.claim, fetchedAt: row.fetchedAt });
    else missing += 1;
  }
  return { links, missing };
}

export interface VerdictView {
  /** Short chip text. 'unknown' is neutral wording, never negative. */
  label: string;
  tone: "ok" | "neutral" | "warn";
}

export function verdictView(kind: "sees" | "consult", verdict: ChainVerdict): VerdictView {
  if (verdict === "unknown") return { label: "Not confirmed yet", tone: "neutral" };
  if (kind === "sees") {
    return verdict === "yes"
      ? { label: "Sees patients: documented", tone: "ok" }
      : { label: "Sees patients: not documented", tone: "warn" };
  }
  return verdict === "yes"
    ? { label: "Consultation route: documented", tone: "ok" }
    : { label: "No consultation route found", tone: "warn" };
}

export interface ChainNode {
  id: "paper" | "author" | "institution" | "reach";
  title: string;
}

export const CHAIN_NODES: readonly ChainNode[] = [
  { id: "paper", title: "Paper" },
  { id: "author", title: "Author" },
  { id: "institution", title: "Institution" },
  { id: "reach", title: "How to reach" },
];

const CHANNEL_LABEL: Record<ReachRoute["channel"], string> = {
  email: "Email",
  voice: "Phone",
  web_form: "Online form",
  page: "Web page",
};

export function channelLabel(channel: ReachRoute["channel"]): string {
  return CHANNEL_LABEL[channel];
}

export function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** The one dynamic fact a row shows: this person is documented as seeing patients. Anything else stays in the detail. */
export function rowBadge(chain: Pick<ExpertChain, "seesPatients">): VerdictView | null {
  return chain.seesPatients.verdict === "yes" ? { label: "Sees patients", tone: "ok" } : null;
}

/** Second line of a row: where they work, and how many papers connect them to your condition. */
export function rowMeta(chain: ExpertChain): string {
  const papers = chainPapers(chain).length;
  const where = chain.institution.name ?? "Workplace not confirmed yet";
  return `${where} · ${papers} ${papers === 1 ? "paper" : "papers"}`;
}

export function describeTrace(trace: ExpertTrace): string {
  const n = trace.chains.length;
  const when = new Date(trace.tracedAt);
  const date = Number.isNaN(when.getTime()) ? "" : ` on ${when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  return `${n} ${n === 1 ? "expert" : "experts"} found${date}.`;
}

/** Toast after a refresh: what was newly found, and that nobody was contacted. */
export function refreshMessage(added: { affiliations: number; contactPoints: number }): string {
  const parts = [
    added.affiliations > 0 ? `${added.affiliations} ${added.affiliations === 1 ? "affiliation" : "affiliations"}` : null,
    added.contactPoints > 0 ? `${added.contactPoints} ${added.contactPoints === 1 ? "phone or email contact" : "phone or email contacts"}` : null,
  ].filter(Boolean);
  return parts.length ? `Research refreshed: found ${parts.join(" and ")}. Nobody was contacted.` : "Research refreshed. Nobody was contacted.";
}
