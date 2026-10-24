import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calls, messages, webApplications } from "@/db/schema";
import { getApplicationStore } from "@/lib/web-application/store";
import type { PatientApplication } from "./types";

export interface ContactMessageFacts {
  /** A follow-up the sweep drafted for a contact still waiting on a reply, not yet approved. */
  pendingFollowUp: boolean;
  firstSentAt: string | null;
  lastReplyAt: string | null;
}

export interface MessageFacts {
  facts(contactIds: readonly string[]): Promise<Map<string, ContactMessageFacts>>;
  /** Status only: never the filled fields or the screenshot. */
  applications(caseId: string): Promise<PatientApplication[]>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Per-contact message facts for the patient status, read straight from messages and calls. */
export class PostgresMessageFacts implements MessageFacts {
  async facts(contactIds: readonly string[]) {
    const out = new Map<string, ContactMessageFacts>();
    if (contactIds.length === 0) return out;
    const db = getDb();
    const ids = [...contactIds];
    const rows = await db
      .select({
        id: messages.id, contactId: messages.contactId, direction: messages.direction, approvedAt: messages.approvedAt,
        sentAt: messages.sentAt, receivedAt: messages.receivedAt, classification: messages.classification,
      })
      .from(messages)
      .where(inArray(messages.contactId, ids));
    const voice = await db.select({ contactId: calls.contactId, startedAt: calls.startedAt }).from(calls).where(inArray(calls.contactId, ids));
    for (const id of ids) {
      const mine = rows.filter((r) => r.contactId === id);
      const followUp = mine.some((r) => r.direction === "outbound" && !r.approvedAt && !r.sentAt && (r.classification ?? "").startsWith("follow_up_"));
      const sent = [
        ...mine.filter((r) => r.direction === "outbound" && r.sentAt).map((r) => r.sentAt!.getTime()),
        ...voice.filter((c) => c.contactId === id && c.startedAt).map((c) => c.startedAt!.getTime()),
      ];
      const replies = mine.filter((r) => r.direction === "inbound" && r.receivedAt).map((r) => r.receivedAt!.getTime());
      out.set(id, {
        pendingFollowUp: followUp,
        firstSentAt: sent.length ? new Date(Math.min(...sent)).toISOString() : null,
        lastReplyAt: replies.length ? new Date(Math.max(...replies)).toISOString() : null,
      });
    }
    return out;
  }


  async applications(caseId: string): Promise<PatientApplication[]> {
    if (process.env.WAYFINDER_OFFLINE === "1") return new EmptyMessageFacts().applications(caseId);
    const rows = await getDb()
      .select({ id: webApplications.id, contactId: webApplications.contactId, status: webApplications.status, submittedAt: webApplications.submittedAt })
      .from(webApplications)
      .where(eq(webApplications.caseId, caseId));
    return rows.map((r) => ({ id: r.id, contactId: r.contactId, status: r.status, submittedAt: iso(r.submittedAt) }));
  }
}

/** Offline / memory mode: no message rows to read. */
export class EmptyMessageFacts implements MessageFacts {
  async facts() {
    return new Map<string, ContactMessageFacts>();
  }
  async applications(caseId: string): Promise<PatientApplication[]> {
    const rows = await getApplicationStore().listByCase(caseId);
    return rows.map((r) => ({ id: r.id, contactId: r.contactId, status: r.status, submittedAt: r.submittedAt ?? null }));
  }
}

export function getMessageFacts(): MessageFacts {
  return process.env.DATABASE_URL ? new PostgresMessageFacts() : new EmptyMessageFacts();
}

