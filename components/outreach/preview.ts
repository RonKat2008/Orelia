import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from "@/lib/safety/disclosure";
import type { CaseInput } from "@/lib/contracts";
import type { OutreachContact, OutreachDraft, OutreachTask } from "./types";

/** Synthetic adult case from fixtures/reports/expected/epithelioid-sarcoma.json. */
export const PREVIEW_CASE: CaseInput = {
  diseaseName: "Epithelioid sarcoma",
  diseaseCodes: { icd10: "C49.9" },
  subtype: "Proximal-type",
  stageSummary: "Grade 3, 7.2 cm, deep margin positive, pT4 pNX, INI1/SMARCB1 loss",
  homeCity: "Tucson",
  homeState: "AZ",
  insurer: "Bluepeak Health PPO",
  planId: "BPH-7731-4402-AZ",
  travelLimitMiles: 600,
  goals: ["second_opinion", "trial"],
};

export const PREVIEW_CONTACTS: OutreachContact[] = [
  {
    id: "22222222-2222-4222-8222-222222222221",
    name: "Intake Desk — Demo Sarcoma Center",
    role: "New-patient intake",
    channel: "email",
    address: "intake.demo@example.test",
    state: "drafted",
    nextFollowUpAt: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Referral line — Demo Rare Disease Clinic",
    role: "Referral coordinator",
    channel: "voice",
    address: "+15555550100",
    state: "replied",
    nextFollowUpAt: "2026-10-28T16:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222223",
    name: "Trial contact — Demo NCT study site",
    role: "Trial coordinator",
    channel: "email",
    address: "trials.demo@example.test",
    state: "sent",
    nextFollowUpAt: "2026-10-28T16:00:00.000Z",
  },
];

export const PREVIEW_DRAFTS: OutreachDraft[] = [
  {
    id: "33333333-3333-4333-8333-333333333331",
    contactId: PREVIEW_CONTACTS[0].id,
    contactName: PREVIEW_CONTACTS[0].name,
    sharedFields: ["diseaseName"],
    approvedAt: null,
    rejected: false,
    draft: {
      channel: "email",
      to: "intake.demo@example.test",
      subject: "New-patient inquiry: Epithelioid sarcoma",
      body: [
        "Hello,",
        "",
        "I am writing to ask about a new-patient appointment for an adult with Epithelioid sarcoma.",
        "Please let me know what your intake desk needs to open a chart.",
        "",
        AI_DISCLOSURE_EMAIL,
      ].join("\n"),
    },
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    contactId: PREVIEW_CONTACTS[1].id,
    contactName: PREVIEW_CONTACTS[1].name,
    sharedFields: ["diseaseName", "homeState"],
    approvedAt: null,
    rejected: false,
    draft: {
      channel: "voice",
      toNumber: "+15555550100",
      script: [
        AI_DISCLOSURE_VOICE,
        "I am calling the referral line to ask how an adult patient in AZ can be seen for Epithelioid sarcoma.",
        "I can share only the details the patient approved.",
      ].join(" "),
    },
  },
];

export const PREVIEW_TASKS: OutreachTask[] = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    contactId: PREVIEW_CONTACTS[1].id,
    contactName: PREVIEW_CONTACTS[1].name,
    kind: "referral",
    summary: "They asked for a referral from the current oncologist before scheduling.",
    status: "open",
    dueAt: "2026-10-30T16:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    contactId: PREVIEW_CONTACTS[2].id,
    contactName: PREVIEW_CONTACTS[2].name,
    kind: "records",
    summary: "The site asked for a records packet before screening. Nothing has been sent.",
    status: "open",
    dueAt: "2026-11-02T16:00:00.000Z",
  },
];

const consentKey = (caseId: string) => `wayfinder-consent:${caseId}`;

export type StoredConsent = Record<string, string[]>;

export function readConsentRaw(caseId: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(consentKey(caseId));
}

export function readConsent(caseId: string): StoredConsent | null {
  const raw = readConsentRaw(caseId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredConsent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConsent(caseId: string, consent: StoredConsent) {
  sessionStorage.setItem(consentKey(caseId), JSON.stringify(consent));
  window.dispatchEvent(new Event("wayfinder-consent"));
}

export function subscribeConsent(onChange: () => void) {
  window.addEventListener("wayfinder-consent", onChange);
  return () => window.removeEventListener("wayfinder-consent", onChange);
}
