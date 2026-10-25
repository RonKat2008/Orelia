import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contacts as contactsTable } from "@/db/schema";
import { getCaseActivity, type ContactView, type TaskView, type ThreadView } from "@/lib/cases/activity";
import { sharedDemoAddresses } from "@/lib/outreach/demo-destinations";
import { hasDatabase, truncate } from "../db";
import { maskDestination } from "../mask";
import type { ActivityEvent, ActivityLane, ActivitySource, LaneTargetKind } from "../types";

export interface RawContact {
  id: string;
  address: string;
  firstSentAt: Date | null;
  followUpsSent: number;
}

const TARGET_KINDS: readonly string[] = ["expert", "institution", "trial", "organization"];
const asTargetKind = (kind: string): LaneTargetKind => (TARGET_KINDS.includes(kind) ? (kind as LaneTargetKind) : "unknown");

/** Safe-mode test inboxes / the simulated call sink are labelled as such instead of by address (display only). */
export function destinationLabel(address: string | undefined, channel: "email" | "voice" | "web", demoAddresses: readonly string[]): string {
  if (address && demoAddresses.some((d) => d.toLowerCase() === address.toLowerCase())) {
    if (channel === "voice") return "Test line (safe mode)";
    return address.trim().toLowerCase().endsWith("@agentmail.to") ? "Test inbox (safe mode)" : "Your inbox (safe mode)";
  }
  return maskDestination(address, channel);
}

/** Pure: ContactView(+raw address) -> lane facts. */
export function contactLanes(views: ContactView[], raw: Map<string, RawContact>, demoAddresses: readonly string[]): (Partial<ActivityLane> & { contactId: string })[] {
  return views.map((c) => ({
    contactId: c.id,
    resourceName: c.displayName,
    targetKind: asTargetKind(c.targetKind),
    channel: c.channel,
    destinationLabel: destinationLabel(raw.get(c.id)?.address, c.channel, demoAddresses),
    state: c.state,
    nextFollowUpAt: c.nextFollowUpAt,
    lastActivityAt: c.lastActivityAt,
  }));
}

/** Pure: threads (email only), tasks and the follow-up schedule -> events. */
export function contactEvents(views: ContactView[], threads: ThreadView[], tasks: TaskView[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const names = new Map(views.map((v) => [v.id, v.displayName]));
  for (const thread of threads) {
    for (const m of thread.messages) {
      if (m.channel !== "email" || !m.at) continue;
      const base = { at: m.at, contactId: thread.contactId, meta: { resource: names.get(thread.contactId) ?? null } };
      if (m.direction === "inbound") {
        out.push({ ...base, id: `msg:${m.id}:reply`, kind: "reply_received", title: `Reply from ${thread.label}`, detail: truncate(m.body, 400), meta: { ...base.meta, classification: m.classification } });
      } else if (m.classification?.startsWith("follow_up_")) {
        out.push({ ...base, id: `msg:${m.id}:follow_up`, kind: "follow_up_sent", title: `Follow-up sent to ${thread.label}`, detail: m.subject ?? undefined });
      } else {
        out.push({ ...base, id: `msg:${m.id}:sent`, kind: "email_sent", title: `Email sent to ${thread.label}`, detail: m.subject ?? undefined });
      }
    }
  }
  const byContact = new Map(views.map((v) => [v.id, v]));
  for (const task of tasks) {
    const owner = byContact.get(task.contactId);
    const at = owner?.lastActivityAt ?? task.dueAt;
    if (!at) continue;
    out.push({ id: `task:${task.id}:created`, at, kind: "task_created", contactId: task.contactId, title: task.title ? `Task: ${task.title}` : `Task created (${task.kind})`, meta: { kind: task.kind, status: task.status, dueAt: task.dueAt } });
  }
  for (const v of views) {
    if (!v.nextFollowUpAt || !v.lastActivityAt) continue;
    out.push({ id: `fu:${v.id}:${v.nextFollowUpAt}`, at: v.lastActivityAt, kind: "follow_up_scheduled", contactId: v.id, title: `Follow-up scheduled for ${v.displayName}`, meta: { dueAt: v.nextFollowUpAt } });
  }
  return out;
}

async function loadRawContacts(caseId: string): Promise<Map<string, RawContact>> {
  if (!hasDatabase()) return new Map();
  try {
    const rows = await getDb()
      .select({ id: contactsTable.id, address: contactsTable.address, firstSentAt: contactsTable.firstSentAt, followUpsSent: contactsTable.followUpsSent })
      .from(contactsTable)
      .where(eq(contactsTable.caseId, caseId));
    return new Map(rows.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

/** Contacts + messages + tasks, via the same loaders the tracker uses (lib/cases/activity). */
export const contactsSource: ActivitySource = {
  name: "contacts",
  async load(caseId) {
    const activity = getCaseActivity();
    const [views, threads, tasks, raw] = await Promise.all([activity.contacts(caseId), activity.threads(caseId), activity.tasks(caseId), loadRawContacts(caseId)]);
    return { events: contactEvents(views, threads, tasks), lanes: contactLanes(views, raw, sharedDemoAddresses(process.env)) };
  },
};
