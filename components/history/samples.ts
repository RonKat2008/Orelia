/**
 * Slugs of the synthetic record sets the sample route accepts. Mirrors HISTORY_FIXTURE_SLUGS in
 * fixtures/history (kept here so client code never imports server fixtures).
 */
export const HISTORY_SAMPLE_SLUGS = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;
export type SampleSlug = (typeof HISTORY_SAMPLE_SLUGS)[number];

export const HISTORY_FIXTURE_LABELS: Record<SampleSlug, string> = {
  "epithelioid-sarcoma": "Epithelioid sarcoma (synthetic)",
  "vascular-eds": "Vascular Ehlers-Danlos (synthetic)",
  "igg4-related-disease": "IgG4-related disease (synthetic)",
};
