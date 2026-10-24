import type { CaseInput } from "@/lib/contracts";

/** Case fields a patient can share with one contact. Keys match `minimize()`. */
export const SHAREABLE_FIELDS = [
  {
    key: "diseaseName",
    label: "Diagnosis",
    hint: "The name of the condition, so they know what you are asking about. Most people share this.",
    personal: false,
    defaultShared: true,
  },
  {
    key: "subtype",
    label: "Subtype",
    hint: "A more specific type of your condition. Helps a specialist tell if they treat it.",
    personal: false,
    defaultShared: false,
  },
  {
    key: "stageSummary",
    label: "Stage summary",
    hint: "How far along things were at your last report, in your own record's words.",
    personal: true,
    defaultShared: false,
  },
  {
    key: "homeCity",
    label: "Home city",
    hint: "Lets them judge distance and local options.",
    personal: false,
    defaultShared: false,
  },
  {
    key: "homeState",
    label: "Home state",
    hint: "A wider location than your city. Often enough for eligibility and licensing.",
    personal: false,
    defaultShared: false,
  },
  {
    key: "insurer",
    label: "Insurer",
    hint: "Only needed if they ask whether they take your insurance.",
    personal: true,
    defaultShared: false,
  },
  {
    key: "planId",
    label: "Plan ID",
    hint: "Your member or plan number. Share it only when a clinic asks for it to check coverage.",
    personal: true,
    defaultShared: false,
  },
  {
    key: "travelLimitMiles",
    label: "Travel limit (miles)",
    hint: "How far you could travel, so they only suggest options within reach.",
    personal: false,
    defaultShared: false,
  },
  {
    key: "goals",
    label: "Goals",
    hint: "What you are hoping for, such as a second opinion or a trial.",
    personal: false,
    defaultShared: false,
  },
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
