import type { CareNeeds, NeedResourceKind } from "@/lib/contracts/care-needs";
import type { JudgeConfidence, JudgeResult, JudgeVerdict, Judgement } from "@/lib/contracts/judge";

export interface VerdictSection {
  verdict: JudgeVerdict;
  label: string;
  items: Judgement[];
}

export const VERDICT_LABEL: Record<JudgeVerdict, string> = { keep: "Keep", maybe: "Maybe", drop: "Dropped" };
export const SECTION_LABEL: Record<JudgeVerdict, string> = { keep: "Kept", maybe: "Maybe", drop: "Dropped" };
const CONFIDENCE_LABEL: Record<JudgeConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};
export const KIND_LABEL: Record<Judgement["kind"], string> = {
  expert: "Specialist",
  institution: "Center",
  trial: "Trial",
  organization: "Organization",
};
export const QUESTION_GROUP_LABEL: Record<NeedResourceKind, string> = {
  expert: "Specialists",
  institution: "Centers",
  trial: "Trials",
  organization: "Organizations",
};
export const QUESTION_KIND_ORDER: readonly NeedResourceKind[] = ["expert", "institution", "trial", "organization"];

export const verdictLabel = (verdict: JudgeVerdict) => VERDICT_LABEL[verdict];
export const confidenceLabel = (confidence: JudgeConfidence) => CONFIDENCE_LABEL[confidence];

export function formatScore(score: number): string {
  return `score ${Math.round(score)} / 100`;
}

export function formatRank(rank: number): string {
  return `rank #${rank}`;
}

/** Sections in display order, each sorted by the judge's `order`; empty sections are omitted. */
export function groupVerdicts(judge: JudgeResult): VerdictSection[] {
  const sorted = [...judge.judgements].sort((a, b) => a.order - b.order);
  return (["keep", "maybe", "drop"] as const)
    .map((verdict) => ({
      verdict,
      label: SECTION_LABEL[verdict],
      items: sorted.filter((item) => item.verdict === verdict),
    }))
    .filter((section) => section.items.length > 0);
}

/** Every need item as id -> readable text. */
export function needLabels(needs: CareNeeds | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!needs) return map;
  for (const s of needs.specialties) map.set(s.id, s.subspecialty ? `${s.specialty} (${s.subspecialty})` : s.specialty);
  for (const c of needs.centerCapabilities) map.set(c.id, c.text);
  for (const r of needs.redFlags) map.set(r.id, r.text);
  for (const t of needs.trialEligibility) map.set(t.id, t.text);
  for (const s of needs.supportNeeds) map.set(s.id, s.text);
  return map;
}

/** Resolve need ids to labels; ids that match nothing are skipped. */
export function resolveNeeds(ids: readonly string[], labels: Map<string, string>): string[] {
  return ids.flatMap((id) => {
    const label = labels.get(id);
    return label ? [label] : [];
  });
}

export interface SourceRef {
  id: string;
  title: string;
  url: string;
}

/** Resolve evidence ids to sources, skipping unknown ids and duplicates. */
export function lookupSources(evidenceIds: readonly string[], needs: Pick<CareNeeds, "sources">): SourceRef[] {
  const seen = new Set<string>();
  return evidenceIds.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const source = needs.sources.find((s) => s.id === id);
    return source ? [{ id, title: source.title, url: source.url }] : [];
  });
}

export function groupQuestions(needs: CareNeeds) {
  return QUESTION_KIND_ORDER.map((kind) => ({
    kind,
    label: QUESTION_GROUP_LABEL[kind],
    items: needs.questions.filter((q) => q.resourceKind === kind),
  })).filter((group) => group.items.length > 0);
}

export function builtInSeconds(elapsedMs: number): string {
  return (elapsedMs / 1000).toFixed(1);
}
