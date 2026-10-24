import type { PrepNotes } from "@/lib/appointments/schema";
import type { ApptView } from "./model";

/** Same-origin fetch helpers for the appointments API. Never throw: callers get { ok, reasons }. */
export type Result<T> = { ok: true; data: T } | { ok: false; reasons: string[]; status: number };

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers }, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, reasons: Array.isArray(body.reasons) ? (body.reasons as string[]) : [res.status === 429 ? "rate_limited" : "unavailable"] };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, reasons: ["offline"] };
  }
}

export const loadCaseAppointments = (caseId: string) => call<{ appointments: ApptView[] }>(`/api/cases/${caseId}/appointments`);
export const loadMyAppointments = () => call<{ appointments: ApptView[] }>("/api/appointments");

const act = (id: string, body: unknown) => call<{ appointment: ApptView }>(`/api/appointments/${id}`, { method: "POST", body: JSON.stringify(body) });
export const confirmAppointment = (id: string, candidate: number) => act(id, { action: "confirm", input: { candidate } });
export const dismissAppointment = (id: string) => act(id, { action: "dismiss" });
export const markAppointmentDone = (id: string) => act(id, { action: "done" });
export const savePrep = (id: string, prep: PrepNotes) => act(id, { action: "prep", prep });

export const createAppointment = (caseId: string, input: Record<string, unknown>) =>
  call<{ appointment: ApptView }>(`/api/cases/${caseId}/appointments`, { method: "POST", body: JSON.stringify(input) });

export interface RequestDraftView { kind: "reschedule" | "cancel"; messageId: string; subject: string; body: string }
export const draftChangeRequest = (id: string, kind: "reschedule" | "cancel", note?: string) =>
  call<{ appointment: ApptView | null; request: RequestDraftView }>(`/api/appointments/${id}/request`, { method: "POST", body: JSON.stringify({ kind, ...(note ? { note } : {}) }) });
export const approveChangeRequest = (id: string, kind: "reschedule" | "cancel") =>
  call<{ sentAt: string; appointment: ApptView }>(`/api/appointments/${id}/request/approve`, { method: "POST", body: JSON.stringify({ kind }) });

export interface FeedView { id: string; createdAt: string; revokedAt: string | null; url?: string; webcalUrl?: string }
export const loadFeeds = () => call<{ feeds: FeedView[] }>("/api/calendar/feeds");
export const createFeed = () => call<{ feed: FeedView }>("/api/calendar/feeds", { method: "POST" });
export const revokeFeed = (id: string) => call<{ revoked: true }>(`/api/calendar/feeds/${id}`, { method: "DELETE" });

export interface GoogleStatus { available: boolean; connected: boolean; freeBusy: boolean }
export const loadGoogleStatus = () => call<GoogleStatus>("/api/integrations/google/status");
export const disconnectGoogle = () => call<{ disconnected: true }>("/api/integrations/google/disconnect", { method: "POST" });
