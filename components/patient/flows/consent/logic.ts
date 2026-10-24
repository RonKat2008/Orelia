import { SHAREABLE_FIELDS, fieldValue, type ShareableFieldKey } from "@/components/outreach/fields";
import type { CaseInput } from "@/lib/contracts";
import { CONSENT_COPY } from "./copy";

/** Pure state for the one-detail-per-screen consent flow (docs/DESIGN-v2.md 7.7). */

export type ConsentAnswer = "yes" | "no";
export type ConsentAnswers = Partial<Record<ShareableFieldKey, ConsentAnswer>>;
export type ConsentScreen = ShareableFieldKey | "check";

export interface ConsentItem {
  key: ShareableFieldKey;
  /** What we would share, in plain words. */
  value: string;
}

export interface ConsentItems {
  /** Details we have a value for, in the usual order. Each gets its own question. */
  known: ConsentItem[];
  /** Details with no value yet. Asked only after "Add more details (optional)". */
  missing: ShareableFieldKey[];
}

function hasValue(record: CaseInput, key: ShareableFieldKey): boolean {
  if (key === "goals") return record.goals.length > 0;
  if (key === "travelLimitMiles") return typeof record.travelLimitMiles === "number";
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0;
}

function displayValue(record: CaseInput, key: ShareableFieldKey): string {
  const raw = fieldValue(record, key);
  return key === "travelLimitMiles" ? CONSENT_COPY.travel(raw) : raw;
}

export function consentItems(record: CaseInput): ConsentItems {
  const known: ConsentItem[] = [];
  const missing: ShareableFieldKey[] = [];
  for (const field of SHAREABLE_FIELDS) {
    if (hasValue(record, field.key)) known.push({ key: field.key, value: displayValue(record, field.key) });
    else missing.push(field.key);
  }
  return { known, missing };
}

/** The question screens in order: known details, then (after "Add more details") the missing ones. */
export function flowOrder(items: ConsentItems, extras: boolean): ShareableFieldKey[] {
  const known = items.known.map((item) => item.key);
  return extras ? [...known, ...items.missing] : known;
}

export function firstScreen(order: readonly ShareableFieldKey[]): ConsentScreen {
  return order[0] ?? "check";
}

/** Where Continue goes from a question. A change made from the check page goes straight back to it. */
export function nextScreen(order: readonly ShareableFieldKey[], current: ShareableFieldKey, returnToCheck: boolean): ConsentScreen {
  if (returnToCheck) return "check";
  const index = order.indexOf(current);
  return index >= 0 && index + 1 < order.length ? order[index + 1]! : "check";
}

/**
 * Where Back goes. `null` means leave the flow (the case home). The first "more details" question and any change
 * made from the check page go back to the check page.
 */
export function previousScreen(
  order: readonly ShareableFieldKey[],
  current: ConsentScreen,
  returnToCheck: boolean,
  knownCount: number,
): ConsentScreen | null {
  if (current === "check") return order.length > 0 ? order[order.length - 1]! : null;
  if (returnToCheck) return "check";
  const index = order.indexOf(current);
  if (index === knownCount && index > 0) return "check";
  return index > 0 ? order[index - 1]! : null;
}

/** Fields the patient said yes to, in the usual field order. Nothing unanswered is ever shared. */
export function sharedFromAnswers(answers: ConsentAnswers): ShareableFieldKey[] {
  return SHAREABLE_FIELDS.filter((field) => answers[field.key] === "yes").map((field) => field.key);
}

/** Who the questions are about: one name, or "the 2 people you picked". */
export function audienceLabel(names: readonly string[]): string {
  if (names.length === 0) return CONSENT_COPY.audience.none;
  if (names.length === 1) return names[0]!;
  return CONSENT_COPY.audience.many(names.length);
}

export interface ConsentSummaryRow {
  key: ShareableFieldKey;
  label: string;
  value: string;
}

/** Rows for "Here's what {org} will see": every question asked, with what will be shared. */
export function summaryRows(order: readonly ShareableFieldKey[], items: ConsentItems, answers: ConsentAnswers): ConsentSummaryRow[] {
  const values = new Map(items.known.map((item) => [item.key, item.value] as const));
  return order.map((key) => {
    const value = values.get(key);
    const yes = answers[key] === "yes";
    return {
      key,
      label: CONSENT_COPY.label[key],
      value: !yes ? CONSENT_COPY.notShared : value !== undefined ? CONSENT_COPY.shared(value) : CONSENT_COPY.sharedLater,
    };
  });
}
