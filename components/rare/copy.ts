/**
 * Patient copy for the "Your condition" card, the symptom summary and travel help. Grade 6 to 8, at most 20 words
 * per sentence, no banned words (tests/rare-ui/readability.test.ts). Judge-only labels live in the components.
 */
export const RARE_COPY = {
  card: {
    title: "Your condition",
    lede: "The few specialists who know your condition",
    source: (label: string) => `Source: ${label}`,
    quoted: (value: string) => `The source says "${value}".`,
    seeList: "See your list",
    whereFrom: "See where this comes from",
    codes: "codes for your condition",
    loading: "Loading your condition",
    failed: "We couldn't load this part just now.",
  },
  symptoms: {
    title: "In your own words",
    lede: "We quote what you and your records say. We do not guess what it is.",
    empty: "Add your records and we will quote what they say here.",
  },
  travel: {
    title: "You may have to travel — here's help with that",
    lede: "These groups may help pay for travel or care.",
    kinds: { travel_aid: "Help with travel", financial_aid: "Help with costs" },
    opens: "Opens their website",
  },
} as const;
