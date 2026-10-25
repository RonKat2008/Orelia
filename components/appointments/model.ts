import type { PublicAppointment } from "@/lib/appointments/http";

/** Pure view helpers for appointment cards (safe on server and client). */
export type ApptView = PublicAppointment;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 17 days", "in 3 hours", "in 20 minutes", "now", "2 days ago". */
export function countdown(startsAt: string, now: number): string {
  const diff = new Date(startsAt).getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs >= 2 * DAY ? ["day", DAY] as const : abs >= 2 * HOUR ? ["hour", HOUR] as const : ["minute", MINUTE] as const;
  const n = Math.max(1, Math.round(abs / unit[1]));
  if (abs < MINUTE * 5) return "starting now";
  const label = `${n} ${unit[0]}${n === 1 ? "" : "s"}`;
  return diff > 0 ? `in ${label}` : `${label} ago`;
}

export function isUpcoming(a: ApptView, now: number): boolean {
  return a.status === "confirmed" && !!a.startsAt && new Date(a.endsAt ?? a.startsAt).getTime() > now;
}

export interface Grouped { proposed: ApptView[]; upcoming: ApptView[]; past: ApptView[] }

export function groupAppointments(list: ApptView[], now: number): Grouped {
  const byStart = (a: ApptView, b: ApptView) => (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
  return {
    proposed: list.filter((a) => a.status === "proposed" || (a.status === "rescheduled" && a.candidates.length > 0)).sort(byStart),
    upcoming: list.filter((a) => isUpcoming(a, now)).sort(byStart),
    past: list.filter((a) => !isUpcoming(a, now) && a.status !== "proposed").sort(byStart).reverse(),
  };
}

export function dateBlock(startsAt: string, timeZone: string): { month: string; day: string; weekday: string } {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...o }).format(new Date(startsAt));
  return { month: f({ month: "short" }), day: f({ day: "numeric" }), weekday: f({ weekday: "long" }) };
}

export function timeRange(a: Pick<ApptView, "startsAt" | "endsAt" | "timezone">): string {
  if (!a.startsAt) return "Time to be confirmed";
  const f = (iso: string, zone: boolean) => new Intl.DateTimeFormat("en-US", { timeZone: a.timezone, hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" } : {}) }).format(new Date(iso));
  return a.endsAt ? `${f(a.startsAt, false)} – ${f(a.endsAt, true)}` : f(a.startsAt, true);
}

export function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

export const REQUEST_REASON_COPY: Record<string, string> = {
  not_allowlisted: "This office's address is not on the outbound allowlist for this deployment, so nothing was sent.",
  follow_up_cadence: "Orelia paces messages to each office, and it is too soon to write again. Calling the office is the quickest way to change the time.",
  consent_required: "Share settings for this contact are missing. Review consent first.",
  call_the_office: "This office was reached by phone. Call them to change the time.",
  no_contact: "This appointment is not linked to an office Orelia wrote to. Call the office directly.",
  medical_advice: "The message was held back because it read like medical advice.",
  unshared_field: "The message mentions details you have not chosen to share with this office.",
  missing_disclosure: "The message was missing the AI disclosure, so it was not sent.",
  inactive_contact: "This contact is closed, so nothing was sent.",
  contact_cap: "You already have the maximum number of active contacts.",
  already_approved: "This request was already approved.",
};

export function reasonText(reasons: string[]): string {
  return reasons.map((r) => REQUEST_REASON_COPY[r] ?? "Something went wrong. Nothing was sent.").filter((v, i, all) => all.indexOf(v) === i).join(" ");
}
