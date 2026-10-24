import { getCaseActivity } from "@/lib/cases/activity";
import { getPlanStore } from "@/lib/plan/store";
import { getMessageFacts } from "@/lib/patient-status/message-facts";
import { patientStatus } from "@/lib/patient-status/status";
import { patientTimeline } from "@/lib/patient-status/timeline";
import type { PatientCaseSnapshot, PatientStatus, PatientTimelineItem } from "@/lib/patient-status/types";
import { getServices } from "./services";

export const EXPECTED_SOURCES = 9;
const SHORTLIST_STATUSES = new Set(["ready", "research_failed"]);

export interface PatientStatusBody {
  caseId: string;
  status: PatientStatus;
  timeline: PatientTimelineItem[];
}

/** Reads the case's own rows into the plain snapshot patientStatus() works on. Read-only. */
export async function loadPatientSnapshot(caseId: string, cache: { shortlistTotal?: number } = {}): Promise<PatientCaseSnapshot> {
  const { cases, runs, persist } = getServices();
  const found = await cases.get(caseId);
  const empty: PatientCaseSnapshot = {
    caseId, found: false, caseStatus: null, diseaseName: null, runs: [], expectedSources: EXPECTED_SOURCES,
    shortlist: null, contacts: [], tasks: [], applications: [], plan: null,
  };
  if (!found) return empty;

  const activity = getCaseActivity();
  const facts = getMessageFacts();
  const [runRows, contactRows, taskRows, plan, applications] = await Promise.all([
    runs.listByCase(caseId),
    activity.contacts(caseId).catch(() => []),
    activity.tasks(caseId).catch(() => []),
    getPlanStore().latest(caseId).catch(() => null),
    facts.applications(caseId).catch(() => []),
  ]);
  const messageFacts = await facts.facts(contactRows.map((c) => c.id)).catch(() => new Map());

  let shortlist: PatientCaseSnapshot["shortlist"] = null;
  if (SHORTLIST_STATUSES.has(found.status) && contactRows.length === 0) {
    try {
      cache.shortlistTotal ??= (await persist.getShortlist(caseId)).length;
      shortlist = { total: cache.shortlistTotal, suggested: 0 };
    } catch {
      shortlist = null;
    }
  }

  return {
    caseId,
    found: true,
    caseStatus: found.status,
    diseaseName: found.diseaseName ?? null,
    runs: runRows.map((r) => ({ agent: r.agent, status: r.status, startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null })),
    expectedSources: EXPECTED_SOURCES,
    shortlist,
    contacts: contactRows.map((c) => {
      const f = messageFacts.get(c.id);
      return {
        id: c.id, name: c.displayName, channel: c.channel, state: c.state, consented: c.consented, approved: c.approved,
        nextFollowUpAt: c.nextFollowUpAt, lastActivityAt: c.lastActivityAt,
        pendingFollowUp: f?.pendingFollowUp ?? false, pendingReply: f?.pendingReply ?? null, firstSentAt: f?.firstSentAt ?? null, lastReplyAt: f?.lastReplyAt ?? null,
      };
    }),
    tasks: taskRows.map((t) => ({ id: t.id, contactId: t.contactId, kind: t.kind, title: t.title, status: t.status, dueAt: t.dueAt })),
    applications,
    plan: plan ? { status: plan.status } : null,
  };
}

export function buildPatientStatusBody(snapshot: PatientCaseSnapshot, now: Date, timeZone: string | undefined): PatientStatusBody {
  return { caseId: snapshot.caseId, status: patientStatus(snapshot, { now, timeZone }), timeline: patientTimeline(snapshot) };
}

/** ?tz= from the browser, only when it is a real IANA zone. */
export function timeZoneFrom(req: Request): string | undefined {
  const tz = new URL(req.url).searchParams.get("tz");
  if (!tz || tz.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
