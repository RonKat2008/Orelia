import type { PatientTone } from "@/lib/patient-status/types";

/**
 * Every string the patient case home and its action cards show (docs/DESIGN-v2.md 7.4). One object so the
 * readability script can score it: grade 6 to 8, at most 20 words per sentence, "you" and "we".
 * The status headline itself comes from lib/patient-status and is not repeated here.
 */
export const PATIENT_HOME_COPY = {
  status: {
    you: "Your turn",
    working: "We're working",
    waiting: "Waiting to hear back",
    good: "Good news",
    problem: "Needs a look",
  } satisfies Record<PatientTone, string>,
  updated: (ago: string) => `Updated ${ago}`,
  searchProgress: {
    label: "Search progress",
    valueText: (done: number, total: number) => `${done} of ${total} sources done`,
  },
  steps: {
    label: "Your progress",
    text: (step: number, total: number, label: string) => `Step ${step} of ${total} · ${label}`,
  },
  happened: {
    title: "What's happened",
    empty: "Nothing yet. We'll add each step here as it happens.",
    seeAll: "See all",
    seeAllHidden: "of what's happened",
  },
  manage: {
    title: "Manage case",
    judgeView: "Judge view",
  },
  loading: "Loading your case",
  missing: {
    title: "We couldn't find this case",
    description: "It may have been removed, or the link may be cut short.",
    action: "Start again",
  },
  loadFailed: {
    title: "We couldn't load your case just now",
    action: "Try again",
  },
  seeDetails: "See details",
  errorTitle: "There is a problem",
  retry: {
    title: "Try the search again?",
    action: "Try the search again",
    busy: "Starting",
    failed: "The search didn't restart. Try again in a minute.",
    toast: "Searching again",
  },
  trySomeoneElse: {
    title: "Try someone else",
    lede: "Your list still has other people and programs who may help.",
  },
  confirm: {
    title: "Is this right?",
    rows: {
      condition: "Condition",
      home: "Where you live",
      travel: "How far you can travel",
      goals: "Hoping for",
      insurance: "Insurance",
    },
    travel: (miles: number) => `Up to ${miles} miles`,
    goals: {
      second_opinion: "A second opinion",
      treatment: "Treatment at a specialist center",
      trial: "A clinical trial",
      support: "Support",
      aid: "Help with money or travel",
    } as Record<string, string>,
    action: "Looks right, start looking",
    busy: "Starting",
    loadFailed: "We couldn't load your details. Try again in a moment.",
    startFailed: "We couldn't start the search. Nothing was sent to anyone. Try again.",
    toast: "Your search has started",
  },
  documents: {
    title: "Your documents",
    empty: "No documents yet. Add some so our agents can use them.",
    count: (total: number, ready: number) =>
      `${total} ${total === 1 ? "document" : "documents"}, ${ready} ready for your agents`,
    action: "Add documents",
  },
  form: {
    title: (name: string) => `Online form for ${name}`,
    fallbackName: "this program",
    loadFailed: "We couldn't load this form. Open the details to see it.",
    blank: (count: number) =>
      count === 1
        ? "1 required question was left blank because you didn't share that detail."
        : `${count} required questions were left blank because you didn't share that detail.`,
    action: "Send this form",
    busy: "Sending",
    reassurance: "We send it once you say OK. We'll tell you when they answer.",
    toast: "Form sent",
    toastDetail: "We'll tell you when they answer.",
  },
} as const;
