import type { CaseInput } from "@/lib/contracts";

/** Case fields a patient can share with one contact. Keys match `minimize()`. */
export const SHAREABLE_FIELDS = [
  { key: "diseaseName", label: "Diagnosis", defaultShared: true },
  { key: "subtype", label: "Subtype", defaultShared: false },
  { key: "stageSummary", label: "Stage summary", defaultShared: false },
  { key: "homeCity", label: "Home city", defaultShared: false },
  { key: "homeState", label: "Home state", defaultShared: false },
  { key: "insurer", label: "Insurer", defaultShared: false },
  { key: "planId", label: "Plan ID", defaultShared: false },
  { key: "travelLimitMiles", label: "Travel limit (miles)", defaultShared: false },
  { key: "goals", label: "Goals", defaultShared: false },
] as const;

export type ShareableFieldKey = (typeof SHAREABLE_FIELDS)[number]["key"];

export const GOAL_LABELS: Record<CaseInput["goals"][number], string> = {
  second_opinion: "Second opinion",
  treatment: "Treatment",
  trial: "Clinical trial",
  support: "Support",
  aid: "Financial or travel aid",
};

export function defaultSharedFields(): ShareableFieldKey[] {
  return SHAREABLE_FIELDS.filter((field) => field.defaultShared).map((field) => field.key);
}

export function fieldValue(record: CaseInput, key: ShareableFieldKey): string {
  if (key === "goals") {
    return record.goals.map((goal) => GOAL_LABELS[goal]).join(", ");
  }
  if (key === "travelLimitMiles") {
    return typeof record.travelLimitMiles === "number" ? String(record.travelLimitMiles) : "Not on file";
  }
  const value = record[key];
  return value && value.length > 0 ? value : "Not on file";
}

export function sharedPreview(
  record: CaseInput,
  shared: readonly ShareableFieldKey[],
): { key: ShareableFieldKey; label: string; value: string }[] {
  return SHAREABLE_FIELDS.filter((field) => shared.includes(field.key)).map((field) => ({
    key: field.key,
    label: field.label,
    value: fieldValue(record, field.key),
  }));
}

export function withheldLabels(shared: readonly ShareableFieldKey[]): string[] {
  return SHAREABLE_FIELDS.filter((field) => !shared.includes(field.key)).map((field) => field.label);
}
