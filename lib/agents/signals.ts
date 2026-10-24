import type { RankSignal, RankingCandidate, SignalName } from "./placeholder-rank";
import type { EvidenceWithId, VerifiedRecord } from "./verifier";

/**
 * Derive ranking signals from VERIFIED records only. Signal text is built from the evidence claims
 * (which carry tool-provided source URLs), never from model prose. Signals describe fit and access,
 * not treatment quality (HARD RULE 1).
 */

const PAPER = /paper|publication|literature|pubmed|article/i;
const TRIAL_LED = /trial.*(led|investigator|pi)|principal/i;
const INTAKE = /intake|referral|new[_ ]patient|accepting|second[_ ]opinion|navigator/i;
const CONTACT = /contact|phone|email|url|website|intake/i;
const DESIGNATION = /nci|designat|comprehensive|center/i;

function pick(evidence: readonly EvidenceWithId[], test: (e: EvidenceWithId) => boolean): EvidenceWithId[] {
  return evidence.filter(test);
}

function signal(matches: EvidenceWithId[], perItem: number, base: number, label: string): RankSignal {
  if (matches.length === 0 && base === 0) return { value: 0, text: "No supporting evidence found", evidenceIds: [] };
  const value = Math.min(1, base + matches.length * perItem);
  const text = matches.length ? `${matches.length} sourced ${label}: ${matches[0]!.claim}` : label;
  return { value, text, evidenceIds: matches.map((m) => m.id) };
}

export function computeSignals(
  record: VerifiedRecord,
  all: readonly VerifiedRecord[],
): Record<SignalName, RankSignal> {
  const ev = record.evidence;
  const r = record.resource;

  const papers = pick(ev, (e) => e.sourceKind === "pubmed" || PAPER.test(e.claimType));
  const trialLed = pick(ev, (e) => TRIAL_LED.test(e.claimType));
  const nci = pick(ev, (e) => e.sourceKind === "nci" || DESIGNATION.test(e.claimType));
  const intake = pick(ev, (e) => INTAKE.test(e.claimType));
  const contact = pick(ev, (e) => CONTACT.test(e.claimType));

  let expertise: RankSignal;
  if (r.kind === "trial") {
    const ctgov = pick(ev, (e) => e.sourceKind === "ctgov");
    expertise = signal(ctgov, 0.5, r.status?.toUpperCase().includes("RECRUIT") ? 0.5 : 0, "ClinicalTrials.gov record(s)");
  } else {
    expertise = signal([...papers, ...trialLed], 0.2, 0, "publication/trial claim(s)");
  }

  let fit: RankSignal;
  if (r.kind === "expert") {
    const inst = all.find((a) => a.resource.id === r.institutionId);
    const instNci = inst ? pick(inst.evidence, (e) => e.sourceKind === "nci") : [];
    fit = instNci.length
      ? { value: 0.8, text: `Affiliated institution: ${instNci[0]!.claim}`, evidenceIds: instNci.map((e) => e.id) }
      : signal(pick(ev, (e) => e.sourceKind === "nppes"), 0.4, 0, "NPPES registry claim(s)");
  } else {
    fit = signal(nci, 0.5, 0, "center designation claim(s)");
  }

  return {
    subtypeExpertise: expertise,
    institutionalFit: fit,
    access: signal(intake, 0.5, 0, "intake/referral path claim(s)"),
    contactability: signal(contact, 0.5, 0, "contact claim(s)"),
  };
}

export function toCandidate(record: VerifiedRecord, all: readonly VerifiedRecord[]): RankingCandidate & { record: VerifiedRecord } {
  return { id: record.resource.id, signals: computeSignals(record, all), record };
}
