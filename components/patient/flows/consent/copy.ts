import type { ShareableFieldKey } from "@/components/outreach/fields";

/**
 * Every string the patient consent flow shows (docs/DESIGN-v2.md 7.7). One object so the readability script can
 * score it. Never say "Not on file" here: missing details sit behind "Add more details (optional)".
 */
export const CONSENT_COPY = {
  /** The detail as it ends a question: "Can we tell {org} your city?". */
  detail: {
    diseaseName: "your diagnosis",
    subtype: "the type of your condition",
    stageSummary: "how things stand, from your report",
    homeCity: "your city",
    homeState: "your state",
    insurer: "your insurance company",
    planId: "your insurance member ID",
    travelLimitMiles: "how far you can travel",
    goals: "what you're hoping for",
  } satisfies Record<ShareableFieldKey, string>,
  /** The row label on the check-answers page. */
  label: {
    diseaseName: "Your diagnosis",
    subtype: "Type of condition",
    stageSummary: "How things stand",
    homeCity: "Your city",
    homeState: "Your state",
    insurer: "Insurance company",
    planId: "Insurance member ID",
    travelLimitMiles: "How far you can travel",
    goals: "What you're hoping for",
  } satisfies Record<ShareableFieldKey, string>,
  question: (org: string, key: ShareableFieldKey) => `Can we tell ${org} ${CONSENT_COPY.detail[key]}?`,
  travel: (miles: string) => `Up to ${miles} miles`,
  later: "You haven't told us this yet. We'd share it only if you add it later.",
  yes: "Yes, share it",
  no: "No, keep it private",
  choiceError: "Choose yes or no",
  errorPrefix: "Error: ",
  continue: "Continue",
  back: "Back",
  backToCase: "Back to your case",
  addMore: "Add more details (optional)",
  checkTitle: (org: string) => `Here's what ${org} will see`,
  checkLede: "You can change any answer before you save.",
  shared: (value: string) => value,
  sharedLater: "Yes, if you add it later",
  notShared: "Not shared",
  save: "Save and continue",
  saving: "Saving",
  reassurance: "Only what you say yes to is shared. Every message says an AI helped write it.",
  audience: {
    none: "them",
    many: (count: number) => `the ${count} people you picked`,
  },
  toast: "Saved",
  toastDetail: "Next, we'll show you how we'll reach them.",
  failToast: "Your choices weren't saved for everyone",
  failToastDetail: "Nothing was sent.",
  failure: (who: string, reasons: string) => `${who}: ${reasons}`,
  loading: "Loading your details",
  loadFailed: "We couldn't load your details. Try again in a moment.",
  pageTitle: "What we may share",
  done: {
    title: "You've already chosen what to share",
    description: "Your case shows the next step.",
  },
  nobody: {
    title: "Choose who we contact first",
    description: "Then you'll choose what they may see.",
  },
} as const;
