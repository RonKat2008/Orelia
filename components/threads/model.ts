import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from "@/lib/safety/disclosure";
import { SHAREABLE_FIELDS } from "@/components/outreach/fields";
import { TASK_KIND_LABELS, type OutreachTask } from "@/components/outreach/types";

export const CLINICAL_NOTICE =
  "Wayfinder can't give medical advice. Contact your care team or call 911 for urgent symptoms.";

const CLINICAL =
  /\b(symptom|symptoms|fever|pain|nausea|dosage|medication|prognosis|chemo|chemotherapy|surgery|worsening|urgent)\b/i;

export type ThreadDirection = "outbound" | "inbound";
export type ThreadChannel = "email" | "voice";

export type ThreadTask = Pick<OutreachTask, "id" | "kind" | "status" | "summary">;

export type ThreadEntry = {
  id: string;
  direction: ThreadDirection;
  channel: ThreadChannel;
  subject: string | null;
  body: string;
  sharedFields: string[];
  disclosure: string | null;
  at: string | null;
  classification: { label: string; rationale: string } | null;
  task: ThreadTask | null;
  clinical: boolean;
};

export type ContactThread = {
  contactId: string;
  label: string;
  entries: ThreadEntry[];
};

export type ThreadsPayload =
  | { status: "ok"; threads: ContactThread[] }
  | { status: "unavailable" }
  | { status: "error" };

const CLASS_LABELS: Record<string, string> = {
  needs_referral: "Needs a referral",
  send_slides: "Send slides",
  send_records: "Send records",
  call_to_schedule: "Call to schedule",
  redirect: "Redirect",
  declined: "Declined",
  unclear: "Unclear",
};

export function looksClinical(text: string): boolean {
  return CLINICAL.test(text);
}

export function fieldLabel(key: string): string {
  const known = SHAREABLE_FIELDS.find((field) => field.key === key);
  return known?.label ?? key.replaceAll("_", " ");
}

export function disclosureFor(entry: Pick<ThreadEntry, "direction" | "channel" | "body" | "disclosure">): string | null {
  if (entry.direction !== "outbound") return null;
  if (entry.disclosure) return entry.disclosure;
  if (entry.channel === "voice" && entry.body.includes(AI_DISCLOSURE_VOICE)) return AI_DISCLOSURE_VOICE;
  if (entry.body.includes(AI_DISCLOSURE_EMAIL)) return AI_DISCLOSURE_EMAIL;
  return null;
}

export function parseThreads(value: unknown): ContactThread[] {
  if (!value || typeof value !== "object") return [];
  const record = value as { threads?: unknown; conversations?: unknown };
  const list = Array.isArray(record.threads)
    ? record.threads
    : Array.isArray(record.conversations)
      ? record.conversations
      : [];
  return list.map(parseThread).filter((thread): thread is ContactThread => thread !== null);
}

function parseThread(value: unknown, index: number): ContactThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const contactId = typeof record.contactId === "string" ? record.contactId : `thread-${index}`;
  const label = typeof record.label === "string" ? record.label : typeof record.contactLabel === "string" ? record.contactLabel : "Contact";
  const rawEntries = Array.isArray(record.entries) ? record.entries : Array.isArray(record.messages) ? record.messages : [];
  return {
    contactId,
    label,
    entries: rawEntries.map((entry, entryIndex) => parseEntry(entry, `${contactId}-${entryIndex}`)).filter((entry): entry is ThreadEntry => entry !== null),
  };
}

function parseEntry(value: unknown, fallbackId: string): ThreadEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const transcript = typeof record.transcript === "string" ? record.transcript : null;
  const body = typeof record.body === "string" ? record.body : transcript;
  if (!body) return null;
  const channel: ThreadChannel = record.channel === "voice" || record.kind === "call" || transcript ? "voice" : "email";
  const direction: ThreadDirection = record.direction === "inbound" || record.direction === "in" ? "inbound" : "outbound";
  const sharedFields = Array.isArray(record.sharedFields)
    ? record.sharedFields.filter((field): field is string => typeof field === "string")
    : [];
  const entry: ThreadEntry = {
    id: typeof record.id === "string" ? record.id : fallbackId,
    direction,
    channel,
    subject: typeof record.subject === "string" ? record.subject : null,
    body,
    sharedFields,
    disclosure: typeof record.disclosure === "string" ? record.disclosure : null,
    at: typeof record.at === "string" ? record.at : typeof record.sentAt === "string" ? record.sentAt : typeof record.receivedAt === "string" ? record.receivedAt : null,
    classification: parseClassification(record.classification),
    task: parseTask(record.task),
    clinical: direction === "inbound" && looksClinical(body),
  };
  return entry;
}

function parseClassification(value: unknown): ThreadEntry["classification"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.class === "string" ? record.class : typeof record.label === "string" ? record.label : "";
  const rationale = typeof record.rationale === "string" ? record.rationale : "";
  if (!name && !rationale) return null;
  return { label: CLASS_LABELS[name] ?? name.replaceAll("_", " "), rationale };
}

function parseTask(value: unknown): ThreadTask | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  const kind = typeof record.kind === "string" && record.kind in TASK_KIND_LABELS ? (record.kind as ThreadTask["kind"]) : "unclear";
  const status = record.status === "approved" || record.status === "done" ? record.status : "open";
  const summary = typeof record.summary === "string" ? record.summary : typeof record.draftBody === "string" ? record.draftBody : TASK_KIND_LABELS[kind];
  return { id: record.id, kind, status, summary };
}

