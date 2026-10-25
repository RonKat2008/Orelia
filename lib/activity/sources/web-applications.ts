import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webApplications } from "@/db/schema";
import { hasDatabase, isoOrNull } from "../db";
import type { ActivityEvent, ActivityLane, ActivitySource } from "../types";

export interface AppRow {
  id: string;
  contactId: string | null;
  url: string;
  status: string;
  fieldCount: number;
  missingCount: number;
  hasScreenshot: boolean;
  createdAt: Date;
  approvedAt: Date | null;
  submittedAt: Date | null;
  result: Record<string, unknown> | null;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "the form";
  }
};

export const screenshotUrl = (caseId: string, appId: string): string => `/api/cases/${caseId}/activity/screenshot/${appId}`;

/** Pure: the Kernel (browser) agent's visible steps, derived from the application row's lifecycle. */
export function applicationEvents(caseId: string, rows: AppRow[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const a of rows) {
    const contactId = a.contactId;
    const created = isoOrNull(a.createdAt);
    if (!created) continue;
    const host = hostOf(a.url);
    out.push({ id: `app:${a.id}:open`, at: created, kind: "browser_step", contactId, title: `Opened ${host}`, meta: { host } });
    out.push({
      id: `app:${a.id}:filled`, at: created, kind: "application_filled", contactId,
      title: `Filled ${a.fieldCount} field${a.fieldCount === 1 ? "" : "s"} on ${host}`,
      detail: a.missingCount > 0 ? `${a.missingCount} still need${a.missingCount === 1 ? "s" : ""} your input` : "Waiting for your approval before anything is submitted",
      imageUrl: a.hasScreenshot ? screenshotUrl(caseId, a.id) : undefined,
      meta: { fields: a.fieldCount, missing: a.missingCount },
    });
    const approved = isoOrNull(a.approvedAt);
    if (approved) out.push({ id: `app:${a.id}:approved`, at: approved, kind: "browser_step", contactId, title: `Approved: submitting to ${host}` });
    const submitted = isoOrNull(a.submittedAt);
    if (a.status === "submitted" && submitted) {
      out.push({ id: `app:${a.id}:submitted`, at: submitted, kind: "application_submitted", contactId, title: `Application submitted to ${host}`, detail: applicationConfirmation(a) });
    } else if (["failed", "stale", "refused"].includes(a.status)) {
      out.push({ id: `app:${a.id}:${a.status}`, at: approved ?? created, kind: "browser_step", contactId, title: `Submission ${a.status} on ${host}`, detail: typeof a.result?.reason === "string" ? String(a.result.reason).replace(/_/g, " ") : undefined });
    }
  }
  return out;
}

export function applicationConfirmation(a: Pick<AppRow, "status" | "result">): string | undefined {
  if (a.status !== "submitted") return undefined;
  const c = a.result?.confirmation;
  return typeof c === "string" && c.trim() ? c.trim().slice(0, 200) : "Submitted";
}

export function applicationLanes(caseId: string, rows: AppRow[]): (Partial<ActivityLane> & { contactId: string })[] {
  const latest = new Map<string, AppRow>();
  for (const a of rows) {
    if (!a.contactId) continue;
    const prev = latest.get(a.contactId);
    if (!prev || a.createdAt >= prev.createdAt) latest.set(a.contactId, a);
  }
  return [...latest.entries()].map(([contactId, a]) => ({
    contactId,
    channel: "web" as const,
    destinationLabel: hostOf(a.url),
    application: { status: a.status, screenshotUrl: a.hasScreenshot ? screenshotUrl(caseId, a.id) : undefined, confirmation: applicationConfirmation(a) },
  }));
}

export const webApplicationsSource: ActivitySource = {
  name: "web-applications",
  async load(caseId) {
    if (!hasDatabase()) return { events: [] };
    const rows = await getDb()
      .select({
        id: webApplications.id,
        contactId: webApplications.contactId,
        url: webApplications.url,
        status: webApplications.status,
        fieldCount: sql<number>`jsonb_array_length(${webApplications.fields})`.mapWith(Number),
        missingCount: sql<number>`jsonb_array_length(${webApplications.missing})`.mapWith(Number),
        hasScreenshot: sql<boolean>`${webApplications.screenshot} is not null`,
        createdAt: webApplications.createdAt,
        approvedAt: webApplications.approvedAt,
        submittedAt: webApplications.submittedAt,
        result: webApplications.result,
      })
      .from(webApplications)
      .where(eq(webApplications.caseId, caseId));
    return { events: applicationEvents(caseId, rows), lanes: applicationLanes(caseId, rows) };
  },
};
