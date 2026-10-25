import { applicationStatusSchema, filledFieldSchema, missingFieldSchema, type FilledField, type MissingField } from "@/lib/web-application/types";
import { z } from "zod";
import { SHAREABLE_FIELDS } from "./fields";
import { refusalMessages } from "./client";

/** One drafted online application, as the outbox "Review application" card shows it. */
export const apiApplicationSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  contactId: z.string().nullable(),
  url: z.string().min(1),
  fields: z.array(filledFieldSchema),
  missing: z.array(missingFieldSchema),
  screenshot: z.string().nullable(),
  status: applicationStatusSchema,
  approvedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type ApiApplication = z.infer<typeof apiApplicationSchema>;

export const APPLICATION_REFUSALS: Record<string, string> = {
  application_not_found: "This application was not found.",
  page_changed: "The form changed after you reviewed it. Nothing was submitted; it needs a fresh review.",
  submit_failed: "The form could not be submitted. Nothing is marked as sent.",
};

/** Loads the case's drafted applications. Rows that fail validation are dropped; failures return []. */
export async function loadApplications(caseId: string, fetchImpl: typeof fetch = fetch): Promise<ApiApplication[]> {
  try {
    const response = await fetchImpl(`/api/cases/${encodeURIComponent(caseId)}/applications`);
    if (!response.ok) return [];
    const data = (await response.json()) as { applications?: unknown };
    const rows = Array.isArray(data.applications) ? data.applications : [];
    return rows.flatMap((row) => {
      const parsed = apiApplicationSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export type ApplicationApproval = { ok: true; submittedAt: string } | { ok: false; reasons: string[] };

/** The server sets approved_at, runs the outbound gate and submits once. */
export async function approveApplicationRequest(
  caseId: string,
  applicationId: string,
  sharedDocIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ApplicationApproval> {
  try {
    const response = await fetchImpl(
      `/api/cases/${encodeURIComponent(caseId)}/applications/${encodeURIComponent(applicationId)}/approve`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sharedDocIds: [...sharedDocIds] }) },
    );
    const data = (await response.json().catch(() => ({}))) as { reasons?: unknown; submittedAt?: unknown };
    if (!response.ok) {
      const reasons = Array.isArray(data.reasons) ? data.reasons.filter((r): r is string => typeof r === "string") : [];
      return { ok: false, reasons: reasons.length ? reasons.map((r) => APPLICATION_REFUSALS[r] ?? refusalMessages([r])[0]) : refusalMessages([]) };
    }
    if (typeof data.submittedAt !== "string") return { ok: false, reasons: ["The server did not confirm the submission."] };
    return { ok: true, submittedAt: data.submittedAt };
  } catch {
    return { ok: false, reasons: ["Could not reach the server. Nothing was submitted."] };
  }
}

/** Where a filled value came from, in plain words. */
export function sourceLabel(field: FilledField): string {
  const { source } = field;
  if (source.kind === "consent") {
    const label = SHAREABLE_FIELDS.find((f) => f.key === source.key)?.label ?? source.key;
    return `Your case: ${label} (you ticked this)`;
  }
  if (source.kind === "doc") return `Your document: "${source.snippet}"`;
  if (source.kind === "patient") {
    const from = source.origin === "profile" ? " (from your profile)" : source.origin === "demo" ? " (demo patient)" : source.origin === "earlier" ? " (from an earlier form)" : "";
    return `Your answer for this form${from}`;
  }
  return "AI disclosure, written by Wayfinder";
}

export function displayValue(field: FilledField): string {
  return typeof field.value === "boolean" ? (field.value ? "Yes" : "No") : field.value;
}

export function docIdsOf(fields: readonly FilledField[]): string[] {
  return [...new Set(fields.flatMap((f) => (f.source.kind === "doc" ? [f.source.docId] : [])))];
}

export function requiredMissing(missing: readonly MissingField[]): MissingField[] {
  return missing.filter((m) => m.required);
}
