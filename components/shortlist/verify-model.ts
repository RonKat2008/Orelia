import { contactRoutesOf } from "@/lib/outreach/reachability";
import {
  VERIFY_QUESTION_KEYS,
  type VerificationBadge,
  type VerificationRequest,
  type VerificationStatus,
  type VerifyQuestionKey,
} from "@/lib/verification/contract";
import type { ShortlistCard } from "./data";

/** Plain-language wording of the six questions the call asks, and nothing else. */
export const QUESTION_TEXT: Record<VerifyQuestionKey, string> = {
  treats_condition: "Does the practice see people with this condition?",
  new_adult_patients: "Is it accepting new adult patients?",
  referral_required: "Is a referral needed first?",
  consultations: "Does it offer consultations or second opinions?",
  how_to_start: "What is the first step to get started?",
  insurance: "Does it take the patient's insurance (only if the patient chooses to share it)?",
};

export function verifyQuestions(): string[] {
  return VERIFY_QUESTION_KEYS.map((key) => QUESTION_TEXT[key]);
}

/** `${targetKind}:${targetId}`, the same key the plan and the verification routes use. */
export function resourceKeyOf(card: ShortlistCard): string {
  return `${card.resource.kind}:${card.resource.id}`;
}

/** Only experts and institutions with a code-stamped phone contact point can be verified by phone. */
export function canVerifyByPhone(card: ShortlistCard): boolean {
  if (card.resource.kind !== "expert" && card.resource.kind !== "institution") return false;
  return contactRoutesOf(card.evidence).some((route) => route.channel === "voice");
}

const REASON_TEXT: Record<string, string> = {
  not_approved: "It was not approved, so nothing was dialed.",
  not_allowlisted: "This number is not on the list of numbers this environment may call.",
  contact_cap: "Five contacts are already active. Remove one before adding another.",
  follow_up_cadence: "A call to this number was made too recently.",
  unshared_field: "The call would have shared something you did not tick.",
  missing_disclosure: "The call script was missing the line that says it is an AI.",
  medical_advice: "The script was held back because it read like medical advice.",
  invalid_draft: "The call details were incomplete.",
  consent_mismatch: "Your sharing choices no longer match this call.",
  inactive_contact: "This contact is no longer active.",
};

export function reasonText(code: string): string {
  return REASON_TEXT[code] ?? "A safety check stopped this call.";
}

export function statusText(request: Pick<VerificationRequest, "status" | "blockedReasons">): string {
  const status: VerificationStatus = request.status;
  switch (status) {
    case "awaiting_approval":
      return "Waiting for your approval. Nothing has been dialed.";
    case "calling":
      return "The call is in progress.";
    case "completed":
      return "The call is finished. Answers appear as badges on the card.";
    case "failed":
      return "The call did not go through. Nothing was shared beyond the script above.";
    case "blocked":
      return request.blockedReasons.length > 0
        ? `Blocked before dialing. ${request.blockedReasons.map(reasonText).join(" ")}`
        : "Blocked before dialing by a safety check.";
  }
}

export function sharedFieldsFor(includeInsurer: boolean): ("diseaseName" | "insurer")[] {
  return includeInsurer ? ["diseaseName", "insurer"] : ["diseaseName"];
}

export interface BadgeView {
  id: string;
  text: string;
  /** The callee's own words for this answer, when the call result carries them. */
  quote: string | null;
}

/** Badges for one resource with the verbatim quote (if any) attached. Pure. */
export function badgeViews(
  badges: readonly VerificationBadge[] | undefined,
  requests: readonly VerificationRequest[],
): BadgeView[] {
  return (badges ?? []).map((badge) => {
    const quote = requests
      .filter((r) => r.resourceKey === badge.resourceKey)
      .flatMap((r) => r.result?.answers ?? [])
      .find((a) => a.key === badge.key && a.value === badge.value)?.quote ?? null;
    return { id: badge.evidenceId, text: badge.label, quote };
  });
}
