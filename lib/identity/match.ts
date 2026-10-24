import type { NppesProvider } from "@/lib/sources/nppes";
import { STATE_NAMES, toStateCode } from "@/lib/agents/research/geo";
import { relevantTaxonomy } from "./taxonomies";

export interface IdentityAuthor { firstName: string; lastName: string; middleName?: string; affiliation?: string; affiliations?: readonly string[] }
export type IdentityStatus = "verified" | "probable" | "ambiguous" | "rejected";
export interface IdentityAssessment {
  status: IdentityStatus;
  verified: boolean;
  npi?: string;
  reasons: string[];
  summary: string;
}
const words = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasPhrase = (text: string, phrase: string) => (` ${words(text)} `).includes(` ${words(phrase)} `);
const trainee = /student|resident|trainee|training program|education\/training/i;

/** Pure deterministic assessment. Mailing addresses never corroborate a practice location. */
export function matchIdentity(author: IdentityAuthor, providers: readonly NppesProvider[], disease: string, options: { truncated?: boolean } = {}): IdentityAssessment {
  const affiliations = [...(author.affiliations ?? []), ...(author.affiliation ? [author.affiliation] : [])];
  const given = author.firstName.trim().split(/\s+/);
  const middle = words(author.middleName ?? given.slice(1).join(" "))[0];
  const rejected: string[] = [];
  const candidates: Array<{ provider: NppesProvider; status: "verified" | "probable"; reasons: string[]; summary: string }> = [];
  for (const p of new Map(providers.map((p) => [String(p.number), p])).values()) {
    const reasons: string[] = [];
    if (words(given[0] ?? "").length < 2) reasons.push("initial-only given name cannot identify a clinician");
    if (words(p.basic.first_name ?? "") !== words(given[0] ?? "") || words(p.basic.last_name ?? "") !== words(author.lastName)) reasons.push("first/last name mismatch");
    if (p.enumeration_type !== "NPI-1" || p.basic.status !== "A" || !/^\d{10}$/.test(String(p.number))) reasons.push("not an active individual NPI");
    if (p.taxonomies?.some((t) => t.code === "390200000X" || trainee.test(t.desc ?? ""))) reasons.push("student/resident/trainee taxonomy");
    const taxonomy = p.taxonomies?.find((t) => relevantTaxonomy(disease, t.code, t.desc));
    if (!taxonomy) reasons.push("no disease-relevant clinician taxonomy");
    const registryMiddle = words(p.basic.middle_name ?? "")[0];
    if (middle && registryMiddle && middle !== registryMiddle) reasons.push("middle initial mismatch");
    const locations = (p.addresses ?? []).filter((a) => a.address_purpose === "LOCATION");
    const location = locations.find((a) => {
      const state = toStateCode(a.state);
      const city = a.city;
      const fullState = Object.entries(STATE_NAMES).find(([, code]) => code === state)?.[0];
      return state && city && affiliations.some((aff) => hasPhrase(aff, city) && (new RegExp(`\\b${state}\\b`).test(aff) || !!fullState && hasPhrase(aff, fullState)));
    });
    if (reasons.length) { rejected.push(`${p.number}: ${reasons.join("; ")}`); continue; }
    const complete = !!location && (!middle || !!registryMiddle);
    const missing = [...(!location ? ["practice city/state not corroborated by author affiliation"] : []), ...(middle && !registryMiddle ? ["registry middle initial missing"] : [])];
    candidates.push({ provider: p, status: complete ? "verified" : "probable", reasons: missing, summary: complete && location ? `NPI verified: ${taxonomy?.desc ?? taxonomy?.code}, ${location.city} ${location.state}, matches affiliation` : `NPI probable: ${missing.join("; ")}` });
  }
  const confirmed = candidates.filter((c) => c.status === "verified");
  if (!options.truncated && confirmed.length === 1 && candidates.length === 1) {
    const c = confirmed[0];
    return { status: "verified", verified: true, npi: String(c.provider.number), reasons: ["exact name, relevant clinician taxonomy and practice city/state corroborated", ...rejected], summary: c.summary };
  }
  const status = options.truncated || candidates.length > 1 ? "ambiguous" : candidates.length ? "probable" : "rejected";
  return { status, verified: false, reasons: [...(options.truncated ? ["registry results may be truncated"] : []), ...candidates.flatMap((c) => c.reasons), ...rejected, ...(candidates.length > 1 ? ["multiple plausible namesakes"] : []), ...(!providers.length ? ["no registry matches"] : [])], summary: `NPI ${status}: identity not confirmed` };
}
