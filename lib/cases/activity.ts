import { and, eq, inArray, isNotNull, isNull, like } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  calls,
  consents,
  contacts,
  experts,
  institutions,
  messages,
  organizations,
  tasks,
  trials,
} from "@/db/schema";
import { isCallEvent, isMailEvent } from "./timeline";

const kind = z.enum(["expert", "institution", "trial", "organization"]);
const channel = z.enum(["email", "voice"]);
export const contactViewSchema = z.object({
  id: z.uuid(),
  targetKind: kind,
  targetId: z.uuid(),
  displayName: z.string(),
  channel,
  state: z.string(),
  nextFollowUpAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  consented: z.boolean(),
  approved: z.boolean(),
  /** A follow-up (follow_up_*) is drafted and waiting for the patient's approval in the outbox. */
  followUpAwaitingApproval: z.boolean().optional(),
});

export const contactsResponseSchema = z.object({
  caseId: z.uuid(),
  contacts: z.array(contactViewSchema),
  openTaskCount: z.number().int().nonnegative(),
});

export const taskViewSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  kind: z.string(),
  title: z.string(),
  status: z.enum(["open", "approved"]),
  dueAt: z.string().nullable(),
});

export const tasksResponseSchema = z.object({
  caseId: z.uuid(),
  tasks: z.array(taskViewSchema),
});

export const threadEntrySchema = z.object({
  id: z.uuid(),
  direction: z.enum(["outbound", "inbound"]),
  channel,
  subject: z.string().nullable(),
  body: z.string(),
  sharedFields: z.array(z.string()),
  at: z.string().nullable(),
  classification: z.string().nullable(),
});

export const threadsResponseSchema = z.object({
  caseId: z.uuid(),
  threads: z.array(z.object({
    contactId: z.uuid(),
    label: z.string(),
    messages: z.array(threadEntrySchema),
  })),
});

export type ContactView = z.infer<typeof contactViewSchema>;
export type TaskView = z.infer<typeof taskViewSchema>;
export type ThreadEntry = z.infer<typeof threadEntrySchema>;
export type ThreadView = z.infer<typeof threadsResponseSchema>["threads"][number];

export interface CaseActivity {
  contacts(caseId: string): Promise<ContactView[]>;
  tasks(caseId: string): Promise<TaskView[]>;
  threads(caseId: string): Promise<ThreadView[]>;
}

type SeedMessage = ThreadEntry & { contactId: string };

export class MemoryCaseActivity implements CaseActivity {
  private readonly people = new Map<string, ContactView[]>();
  private readonly taskRows = new Map<string, TaskView[]>();
  private readonly messageRows = new Map<string, SeedMessage[]>();

  seedContact(caseId: string, contact: ContactView) {
    const list = this.people.get(caseId) ?? [];
    list.push(contact);
    this.people.set(caseId, list);
  }

  seedTask(caseId: string, task: TaskView) {
    const list = this.taskRows.get(caseId) ?? [];
    list.push(task);
    this.taskRows.set(caseId, list);
  }

  seedMessage(caseId: string, message: SeedMessage) {
    const list = this.messageRows.get(caseId) ?? [];
    list.push(message);
    this.messageRows.set(caseId, list);
  }

  async contacts(caseId: string) {
    return structuredClone(this.people.get(caseId) ?? []);
  }

  async tasks(caseId: string) {
    return structuredClone(this.taskRows.get(caseId) ?? []).filter((task) => task.status === "open" || task.status === "approved");
  }

  async threads(caseId: string) {
    const people = this.people.get(caseId) ?? [];
    const messagesFor = this.messageRows.get(caseId) ?? [];
    return people.map((contact) => ({
      contactId: contact.id,
      label: contact.displayName,
      messages: messagesFor.filter((message) => message.contactId === contact.id && message.at !== null).map(({ contactId: _id, ...entry }) => entry),
    }));
  }
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export class PostgresCaseActivity implements CaseActivity {
  private get db() {
    return getDb();
  }

  private async names(rows: { targetKind: string; targetId: string }[]) {
    const ids = (kindName: string) => rows.filter((row) => row.targetKind === kindName).map((row) => row.targetId);
    const named = new Map<string, string>();
    const expertIds = ids("expert");
    const institutionIds = ids("institution");
    const trialIds = ids("trial");
    const orgIds = ids("organization");
    const none = Promise.resolve([] as { id: string; name: string }[]);
    // One parallel round (was four sequential lookups).
    const found = await Promise.all([
      expertIds.length ? this.db.select({ id: experts.id, name: experts.name }).from(experts).where(inArray(experts.id, expertIds)) : none,
      institutionIds.length ? this.db.select({ id: institutions.id, name: institutions.name }).from(institutions).where(inArray(institutions.id, institutionIds)) : none,
      trialIds.length ? this.db.select({ id: trials.id, name: trials.title }).from(trials).where(inArray(trials.id, trialIds)) : none,
      orgIds.length ? this.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : none,
    ]);
    for (const rows of found) for (const row of rows) named.set(row.id, row.name);
    return named;
  }

  async contacts(caseId: string): Promise<ContactView[]> {
    const rows = await this.db.select().from(contacts).where(eq(contacts.caseId, caseId));
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    // Independent reads: one parallel round after the contacts row (was seven sequential queries).
    const [named, consentRows, approvedRows, pendingFollowUpRows] = await Promise.all([
      this.names(rows),
      this.db.select({ contactId: consents.contactId, approvedAt: consents.approvedAt }).from(consents).where(inArray(consents.contactId, ids)),
      this.db
        .select({ contactId: messages.contactId })
        .from(messages)
        .where(and(inArray(messages.contactId, ids), eq(messages.direction, "outbound"), isNotNull(messages.approvedAt))),
      this.db
        .select({ contactId: messages.contactId })
        .from(messages)
        .where(and(inArray(messages.contactId, ids), eq(messages.direction, "outbound"), like(messages.classification, "follow_up_%"), isNull(messages.approvedAt), isNull(messages.sentAt))),
    ]);
    const consented = new Set(consentRows.filter((row) => row.approvedAt).map((row) => row.contactId));
    const approved = new Set(approvedRows.map((row) => row.contactId));
    const awaiting = new Set(pendingFollowUpRows.map((row) => row.contactId));
    return rows.map((row) => contactViewSchema.parse({
      id: row.id,
      targetKind: row.targetKind,
      targetId: row.targetId,
      displayName: named.get(row.targetId) ?? "(unknown)",
      channel: row.channel,
      state: row.state,
      nextFollowUpAt: iso(row.nextFollowUpAt),
      lastActivityAt: iso(row.lastActivityAt),
      consented: consented.has(row.id),
      approved: approved.has(row.id),
      // Only while waiting for a reply: after a reply or a stall the drafted follow-up is moot.
      followUpAwaitingApproval: row.state === "sent" && awaiting.has(row.id),
    }));
  }

  async tasks(caseId: string): Promise<TaskView[]> {
    const people = await this.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.caseId, caseId));
    if (people.length === 0) return [];
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.contactId, people.map((row) => row.id)), inArray(tasks.status, ["open", "approved"])));
    return rows.map((row) => taskViewSchema.parse({
      id: row.id,
      contactId: row.contactId,
      kind: row.kind,
      title: row.title ?? "",
      status: row.status === "approved" ? "approved" : "open",
      dueAt: iso(row.dueAt),
    }));
  }

  async threads(caseId: string): Promise<ThreadView[]> {
    const people = await this.contacts(caseId);
    if (people.length === 0) return [];
    const ids = people.map((person) => person.id);
    const [mail, voice] = await Promise.all([
      this.db.select().from(messages).where(inArray(messages.contactId, ids)),
      this.db.select().from(calls).where(inArray(calls.contactId, ids)),
    ]);
    return people.map((person) => ({
      contactId: person.id,
      label: person.displayName,
      messages: [
        ...mail.filter((row) => row.contactId === person.id && isMailEvent(row)).map((row) => ({
          id: row.id,
          direction: row.direction === "inbound" ? "inbound" as const : "outbound" as const,
          channel: row.channel,
          subject: row.subject,
          body: row.body,
          sharedFields: row.sharedFields,
          at: iso(row.sentAt ?? row.receivedAt),
          classification: row.classification,
        })),
        ...voice.filter((row) => row.contactId === person.id && isCallEvent(row)).map((row) => ({
          id: row.id,
          direction: "outbound" as const,
          channel: "voice" as const,
          subject: null,
          body: row.transcript as string,
          sharedFields: [],
          at: iso(row.startedAt),
          classification: null,
        })),
      ],
    }));
  }
}

const holder = globalThis as unknown as { __wayfinderActivity?: CaseActivity };

export function getCaseActivity(): CaseActivity {
  holder.__wayfinderActivity ??= process.env.DATABASE_URL ? new PostgresCaseActivity() : new MemoryCaseActivity();
  return holder.__wayfinderActivity;
}

export function resetCaseActivity() {
  delete holder.__wayfinderActivity;
}

export function asMemoryActivity(activity: CaseActivity): MemoryCaseActivity {
  if (!(activity instanceof MemoryCaseActivity)) throw new Error("expected memory activity");
  return activity;
}
