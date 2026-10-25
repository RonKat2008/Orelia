import type { ApiContact } from "./client";
import type { OutreachTask } from "./types";

const TASK_KINDS = new Set<OutreachTask["kind"]>([
  "referral",
  "slides",
  "records",
  "call",
  "redirect",
  "unclear",
  "declined",
]);

/** Map GET /api/cases/[id]/contacts onto the contact shape the outreach screens already render. */
export function contactsFromActivity(value: unknown): ApiContact[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { contacts?: unknown }).contacts;
  if (!Array.isArray(raw)) return null;
  const contacts: ApiContact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (row.channel !== "email" && row.channel !== "voice") continue;
    if (typeof row.targetKind !== "string" || typeof row.targetId !== "string") continue;
    contacts.push({
      id: row.id,
      caseId: typeof row.caseId === "string" ? row.caseId : "",
      targetId: row.targetId,
      targetKind: row.targetKind,
      channel: row.channel,
      address: typeof row.address === "string" ? row.address : "",
      ...(row.displayAddress === null || typeof row.displayAddress === "string" ? { displayAddress: row.displayAddress } : {}),
      state: typeof row.state === "string" ? row.state : "drafted",
      displayName: typeof row.displayName === "string" ? row.displayName : undefined,
      nextFollowUpAt: typeof row.nextFollowUpAt === "string" ? row.nextFollowUpAt : null,
      followUpAwaitingApproval: row.followUpAwaitingApproval === true,
    });
  }
  return contacts;
}

/** Map GET /api/cases/[id]/tasks onto tracker cards. Names come from the contacts list. */
export function tasksFromActivity(value: unknown, names: ReadonlyMap<string, string> = new Map()): OutreachTask[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { tasks?: unknown }).tasks;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): OutreachTask[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.contactId !== "string") return [];
    const kind = typeof row.kind === "string" && TASK_KINDS.has(row.kind as OutreachTask["kind"])
      ? (row.kind as OutreachTask["kind"])
      : "unclear";
    const title = typeof row.title === "string" && row.title ? row.title : typeof row.summary === "string" ? row.summary : "";
    return [{
      id: row.id,
      contactId: row.contactId,
      contactName: names.get(row.contactId) ?? "Contact",
      kind,
      summary: title || "A task needs a look",
      status: row.status === "approved" || row.status === "done" ? row.status : "open",
      dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
    }];
  });
}

export async function loadCaseContacts(caseId: string, fetchImpl: typeof fetch = fetch): Promise<ApiContact[] | null> {
  try {
    const response = await fetchImpl(`/api/cases/${encodeURIComponent(caseId)}/contacts`);
    if (!response.ok) return null;
    return contactsFromActivity(await response.json());
  } catch {
    return null;
  }
}

export async function loadCaseTasks(
  caseId: string,
  names: ReadonlyMap<string, string> = new Map(),
  fetchImpl: typeof fetch = fetch,
): Promise<OutreachTask[] | null> {
  try {
    const response = await fetchImpl(`/api/cases/${encodeURIComponent(caseId)}/tasks`);
    if (!response.ok) return null;
    return tasksFromActivity(await response.json(), names);
  } catch {
    return null;
  }
}

/**
 * The select response carries contact rows without names. Fill each missing displayName from the live
 * contacts list (GET /api/cases/[id]/contacts), matching by contact id. Returns new objects.
 */
export function withDisplayNames(contacts: readonly ApiContact[], live: readonly ApiContact[] | null): ApiContact[] {
  const names = new Map((live ?? []).flatMap((c) => (c.displayName ? [[c.id, c.displayName] as const] : [])));
  return contacts.map((c) => (c.displayName || !names.has(c.id) ? c : { ...c, displayName: names.get(c.id) }));
}

/** caseCandidateId -> resource name, from GET /api/cases/[id]/shortlist. */
export function namesFromShortlist(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const groups = value && typeof value === "object" ? (value as { groups?: unknown }).groups : undefined;
  if (!groups || typeof groups !== "object") return names;
  for (const items of Object.values(groups as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      if (typeof row.caseCandidateId === "string" && typeof row.name === "string" && row.name) {
        names.set(row.caseCandidateId, row.name);
      }
    }
  }
  return names;
}

export async function loadShortlistNames(caseId: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  try {
    const response = await fetchImpl(`/api/cases/${encodeURIComponent(caseId)}/shortlist`);
    return response.ok ? namesFromShortlist(await response.json()) : new Map();
  } catch {
    return new Map();
  }
}
