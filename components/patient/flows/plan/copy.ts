/** Every string the patient plan shows (docs/DESIGN-v2.md 7.8). One object so the readability script can score it. */
export const PLAN_COPY = {
  title: "How we'll contact them",
  lede: "Check how we'll reach each one. Nothing is sent until you read it.",
  listLabel: "How we'll reach each one",
  action: "OK this plan",
  busy: "Saving",
  loading: "Working out the best way to reach each one",
  toast: "Plan saved",
  toastDetail: "Next, you'll read each message before it's sent.",
  backToCase: "Back to your case",
  doneTitle: "You've already OK'd this plan",
  doneText: "Your case shows the next step.",
  emptyTitle: "No one to plan for yet",
  emptyText: "Choose who we contact first. Then we'll show how we'll reach them.",
} as const;
