import type { Goal } from "../goals";

/**
 * Every string a patient can see in the /start intake. One object so the readability script can score it
 * (grade 6 to 8, at most 20 words per sentence, "you" and "we"). Keep it plain.
 */
export const INTAKE_COPY = {
  progress: {
    label: "Your answers",
    valueText: (step: number, total: number) => `Question ${step} of ${total}`,
  },
  actions: {
    continue: "Continue",
    back: "Back",
    skip: "Skip",
    uploadInstead: "Upload a report instead",
    addDocuments: "Add documents (optional)",
    answerInstead: "Answer questions instead",
    startSearch: "Start the search",
    startingSearch: "Starting your search...",
    tryAgain: "Try again",
  },
  questions: {
    diagnosis: {
      question: "Do you have a diagnosis?",
      hint: "That means a doctor has named your condition.",
      yes: "Yes, I have one",
      no: "Not yet",
      error: "Choose yes or not yet",
    },
    symptoms: {
      question: "What are you dealing with?",
      hint: "Say it in your own words, and we quote you without guessing what it is.",
      label: "In your own words",
    },
    needs: {
      question: "How far could you go, and what do you hope for?",
      hint: "We picked common answers, and you can change any of them.",
      travelLegend: "How far could you travel?",
      goalsLegend: "What are you hoping for?",
    },
    condition: {
      question: "What condition do you need help with?",
      hint: "Use the name on your report, such as vascular Ehlers-Danlos syndrome.",
      errorEmpty: "Tell us your condition so we know what to look for",
      errorTooLong: (max: number) =>
        `Use ${max} letters or fewer for your condition`,
    },
    home: {
      question: "Where do you live?",
      hint: "We use this to find places you can get to, and a city or a state is enough.",
      city: "City",
      state: "State",
      error: "Tell us your city or your state",
    },
    travel: {
      question: "How far could you travel?",
      hint: "Pick what feels possible, and you can change it later.",
      error: "Choose how far you could travel",
    },
    goals: {
      question: "What are you hoping for?",
      hint: "Choose all that apply.",
      error: "Choose at least one thing you are hoping for",
    },
    insurance: {
      question: "Who is your insurance with?",
      hint: "This helps us check which centers may take your plan.",
    },
  },
  travel: {
    labels: {
      local: "Close to home",
      regional: "A few hours away",
      far: "Anywhere in the region",
      anywhere: "Anywhere it takes",
    },
    hints: {
      local: "Up to about 25 miles.",
      regional: "Up to about 100 miles.",
      far: "Up to about 500 miles.",
      anywhere: "No limit on distance.",
    },
    anywhereSummary: "Anywhere it takes",
    milesSummary: (miles: number) => `Up to ${miles} miles`,
  },
  goals: {
    second_opinion: "A second opinion",
    treatment: "Treatment at a specialist center",
    trial: "A clinical trial",
    support: "Support from people who understand",
    aid: "Help with money or travel",
  } satisfies Record<Goal, string>,
  documents: {
    title: "Add any documents (optional)",
    lede: "Lab results, scans, letters. Our agents can read them for your search. You can skip this.",
    skip: "Skip",
    fill: "Fill my answers from these documents",
    filling: "Reading your documents...",
    fillHint: "We will use only documents marked ready.",
    failed: "We could not read your documents just now. Skip this step or try again.",
    prefilled: "Pre-filled from your documents. Check and change anything.",
  },
  upload: {
    title: "Upload a report",
    lede: "Add a report or records, and we will pull out the details for you.",
    textLabel: "Your report",
    textHint: "Take out names and record numbers before you paste.",
    placeholder:
      "Paste your report here, or drop a .txt or .md file on this box.",
    upload: "Upload a .txt or .md file",
    nothing: "Nothing added yet",
    words: (count: number) => `${count} words ready`,
    sampleLabel: "Try a sample report",
    samplePlaceholder: "Choose a sample",
    sampleNote: "Samples are made up. No real person is described.",
    noSamples: "No sample reports found.",
    read: "Read my report",
    reading: "Reading your report",
    readingNote: "We are pulling out the details. This only takes a moment.",
    empty: "Add your report first, or choose a sample.",
    unreadable: "We could not read that file. Try pasting the text instead.",
    readFailed:
      "We could not read that report. Paste the text again, or answer a few questions instead.",
  },
  check: {
    title: "Check your answers",
    hint: "Change anything that is not right.",
    rows: {
      condition: "Condition",
      symptoms: "In your own words",
      home: "Where you live",
      travel: "How far you could travel",
      goals: "What you are hoping for",
    },
    changeHidden: {
      condition: "your condition",
      symptoms: "your own words",
      home: "where you live",
      travel: "how far you could travel",
      goals: "what you are hoping for",
    },
    undiagnosedValue: "No diagnosis yet",
    insuranceLabel: "Insurance company (optional)",
    insuranceHint: "This helps us check which centers may take your plan.",
    reassurance: "Nothing is sent to anyone until you say so.",
  },
  errors: {
    start:
      "We could not start your search. Nothing was sent to anyone. Try again.",
    fields: (names: string) => `Check ${names}. Nothing was sent to anyone.`,
    fieldNames: {
      diseaseName: "your condition",
      homeCity: "your city",
      homeState: "your state (a US state)",
      travelLimitMiles: "how far you can travel",
      insurer: "your insurance",
      goals: "what you are hoping for",
    } as Record<string, string>,
  },
} as const;

/** Flat list of every patient-visible string, for the readability script. */
export function intakeCopyStrings(value: unknown = INTAKE_COPY): string[] {
  if (typeof value === "string") return [value];
  if (
    typeof value === "function" ||
    value === null ||
    typeof value !== "object"
  )
    return [];
  return Object.values(value).flatMap((item) => intakeCopyStrings(item));
}
