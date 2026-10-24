/**
 * Every string the patient shortlist shows (docs/DESIGN-v2.md 7.6), on the case home and on its own page. One object
 * so the readability script can score it. Never mention scores, tiers, filters or phone checks here.
 */
export const SHORTLIST_COPY = {
  cardTitle: "Pick who we contact first",
  title: "Choose who we contact",
  lede: (found: number, limit: number, suggested: number) =>
    [`We found ${found}.`, `You can pick up to ${limit}.`, suggested > 0 ? `We suggest ${suggested === 1 ? "this 1" : `these ${suggested}`}.` : null]
      .filter(Boolean)
      .join(" "),
  listLabel: "People and groups who may help",
  goodMatch: "Good match",
  why: "Why this one?",
  reach: { email: "Email", voice: "Phone", web_form: "Online form" },
  showMore: (count: number) => `Show ${count} more`,
  chosen: (count: number, limit: number) => `${count} of ${limit} chosen`,
  full: (limit: number) => `You've chosen ${limit}. That's the most for now.`,
  continue: (count: number) => (count > 0 ? `Continue with ${count} chosen` : "Continue"),
  busy: "Saving",
  noneChosen: "Choose at least 1 to contact",
  reassurance: "Nothing is sent yet. Next you choose what they may see.",
  loading: "Loading who we found",
  emptyTitle: "No one to choose yet",
  emptyText: "We'll list people here once the search finds someone we could check.",
  backToCase: "Back to your case",
  failToast: "We couldn't add those people",
  failToastDetail: "Nothing was sent.",
  toast: (count: number) => `Added ${count} to contact`,
  toastSkipped: (count: number) =>
    `${count} ${count === 1 ? "has" : "have"} no public email or phone, so we'll use their online form if they have one.`,
  toastDetail: "Nothing is sent until you OK each message.",
} as const;
