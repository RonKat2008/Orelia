import type { Resource } from "@/lib/contracts";

const tokens = (name: string) => name.toLowerCase().replace(/\b(md|phd|do)\b/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

/** Full given and family names, plus agreement on middle initials when both are present. Initial-only leads are uncertain. */
export function sameInvestigator(author: string, official: string): boolean {
  const a = tokens(author), b = tokens(official);
  return a.length >= 2 && b.length >= 2 && a[0]!.length > 1 && a[0] === b[0] && a.at(-1) === b.at(-1)
    && (!(a.length > 2 && b.length > 2) || a[1]![0] === b[1]![0]);
}

/** Below-threshold or unconfirmed identities stay in research, never patient-facing candidates. */
export function expertEligibility(expert: Extract<Resource, { kind: "expert" }>, resources: readonly Resource[]): { eligible: boolean; reason: string } {
  if (!expert.verified || !expert.npi) return { eligible: false, reason: "identity not verified against clinical taxonomy and affiliation" };
  const papers = expert.profile?.paperCount ?? 0;
  const leads = resources.some((r) => r.kind === "trial" && r.registry?.investigators.some((i) => sameInvestigator(expert.name, i)));
  const eligible = papers >= 2 || papers >= 1 && leads;
  return { eligible, reason: eligible ? "disease publication threshold met" : "requires two disease-specific papers, or one paper plus a relevant trial lead" };
}
