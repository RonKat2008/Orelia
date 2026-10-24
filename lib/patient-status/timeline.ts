import type { PatientCaseSnapshot, PatientTimelineItem } from "./types";

const TERMINAL = new Set(["done", "failed", "not_implemented"]);

/** What a reply asked for, in plain words. Application tasks are shown through the form itself. */
const REPLY_PHRASES: Record<string, string> = {
  records: "they need your records",
  referral: "they need a referral from your doctor",
  slides: "they asked for your slides",
  call: "they asked you to call them",
  redirect: "they pointed us to a different contact",
  declined: "they can't help right now",
  unclear: "take a look at what they said",
};

/** "What's happened" for the patient view: newest first, plain language, deterministic. */
export function patientTimeline(s: PatientCaseSnapshot, options: { limit?: number } = {}): PatientTimelineItem[] {
  const items: PatientTimelineItem[] = [];
  const nameOf = (id: string | null) => s.contacts.find((c) => c.id === id)?.name ?? "A clinic";

  if (s.runs.length > 0) {
    const started = earliest(s.runs.map((r) => r.startedAt));
    const allDone = s.runs.every((r) => TERMINAL.has(r.status));
    if (allDone) {
      const found = s.shortlist?.total ?? 0;
      items.push({
        id: "search-done",
        text: found > 0 ? `Searched ${s.runs.length} public sources and found ${found} ${found === 1 ? "person or program" : "people and programs"}` : `Searched ${s.runs.length} public sources`,
        at: latest(s.runs.map((r) => r.finishedAt)),
      });
    } else {
      items.push({ id: "search-start", text: "Started looking for you", at: started });
    }
  }

  for (const c of s.contacts) {
    const sentAt = c.firstSentAt ?? (c.state !== "drafted" ? c.lastActivityAt : null);
    if (c.state !== "drafted" || c.firstSentAt) {
      items.push({ id: `sent-${c.id}`, text: c.channel === "voice" ? `Called ${c.name}` : `Emailed ${c.name}`, at: sentAt ?? null });
    }
    if (c.state === "stalled") items.push({ id: `stalled-${c.id}`, text: `${c.name} hasn't replied after two follow-ups`, at: c.lastActivityAt });
    if (c.state === "appointment_booked") items.push({ id: `appt-${c.id}`, text: `${c.name} set up an appointment`, at: c.lastActivityAt });
    if (c.state === "connected") items.push({ id: `conn-${c.id}`, text: `You're connected with ${c.name}`, at: c.lastActivityAt });
    if (c.state === "records_sent") items.push({ id: `rec-${c.id}`, text: `Sent your records to ${c.name}`, at: c.lastActivityAt });
    const hasTask = s.tasks.some((t) => t.contactId === c.id && REPLY_PHRASES[t.kind]);
    if (!hasTask && (c.state === "replied" || c.lastReplyAt)) {
      items.push({ id: `reply-${c.id}`, text: `${c.name} replied`, at: c.lastReplyAt ?? c.lastActivityAt });
    }
  }

  for (const t of s.tasks) {
    const phrase = REPLY_PHRASES[t.kind];
    if (!phrase) continue;
    const contact = s.contacts.find((c) => c.id === t.contactId);
    items.push({ id: `task-${t.id}`, text: `${nameOf(t.contactId)} replied: ${phrase}`, at: contact?.lastReplyAt ?? contact?.lastActivityAt ?? null });
  }

  for (const a of s.applications) {
    if (a.status === "submitted") items.push({ id: `app-${a.id}`, text: `Sent your online form to ${nameOf(a.contactId)}`, at: a.submittedAt });
  }

  const sorted = [...items].sort((a, b) => stamp(b.at) - stamp(a.at));
  return sorted.slice(0, options.limit ?? 6);
}

function stamp(at: string | null): number {
  const t = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function latest(values: (string | null | undefined)[]): string | null {
  const t = values.map((v) => (v ? Date.parse(v) : Number.NaN)).filter((n) => !Number.isNaN(n));
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

function earliest(values: (string | null | undefined)[]): string | null {
  const t = values.map((v) => (v ? Date.parse(v) : Number.NaN)).filter((n) => !Number.isNaN(n));
  return t.length ? new Date(Math.min(...t)).toISOString() : null;
}
