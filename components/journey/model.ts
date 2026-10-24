export const JOURNEY_STAGES = [
  "intake",
  "research",
  "shortlist",
  "consent",
  "outreach",
  "tracker",
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const STAGE_LABELS: Record<JourneyStage, string> = {
  intake: "Intake",
  research: "Research",
  shortlist: "Shortlist",
  consent: "Consent",
  outreach: "Outreach",
  tracker: "Tracker",
};

const INTAKE_STATUSES = new Set(["draft", "extracted", "unconfirmed"]);
const RESEARCH_STATUSES = new Set(["confirmed", "researching", "research_failed"]);

export type JourneyContact = {
  consented?: boolean | null;
  approved?: boolean | null;
  state?: string | null;
};

export type JourneySnapshot = {
  status: string | null;
  selectedCount: number | null;
  openTaskCount: number | null;
  contacts: JourneyContact[] | null;
};

export type JourneyStep = {
  id: JourneyStage;
  label: string;
  href: string;
  state: "complete" | "current" | "upcoming";
};

export type JourneyPlan = {
  current: JourneyStage;
  steps: JourneyStep[];
  nextLabel: string;
  nextHref: string;
  documentsHref: string;
  notes: string[];
};

const NEXT: Record<JourneyStage, { label: string; path: (caseId: string) => string }> = {
  intake: { label: "Finish intake", path: () => "/" },
  research: { label: "Open the research swarm", path: (id) => `/cases/${id}/swarm` },
  shortlist: { label: "Choose who to contact", path: (id) => `/cases/${id}/shortlist` },
  consent: { label: "Choose fields to share", path: (id) => `/cases/${id}/consent` },
  outreach: { label: "Review drafts before anything is sent", path: (id) => `/cases/${id}/outbox` },
  tracker: { label: "Open the tracker", path: (id) => `/cases/${id}/tracker` },
};

export function stageHref(stage: JourneyStage, caseId: string): string {
  if (stage === "intake") return "/";
  if (stage === "research") return `/cases/${caseId}/swarm`;
  if (stage === "shortlist") return `/cases/${caseId}/shortlist`;
  if (stage === "consent") return `/cases/${caseId}/consent`;
  if (stage === "outreach") return `/cases/${caseId}/outbox`;
  return `/cases/${caseId}/tracker`;
}

export function resolveJourney(caseId: string, snapshot: JourneySnapshot): JourneyPlan {
  const notes: string[] = [];
  if (snapshot.selectedCount === null) {
    notes.push("The shortlist could not be loaded. Selection counts may be incomplete.");
  }
  if (snapshot.openTaskCount === null) {
    notes.push("Approval tasks could not be loaded.");
  }
  if (snapshot.status === "research_failed") {
    notes.push("Research did not finish. The swarm page lists which agents failed.");
  }

  const current = currentStage(snapshot);
  const index = JOURNEY_STAGES.indexOf(current);
  const next = NEXT[current];

  return {
    current,
    steps: JOURNEY_STAGES.map((id, i) => ({
      id,
      label: STAGE_LABELS[id],
      href: stageHref(id, caseId),
      state: i < index ? "complete" : i === index ? "current" : "upcoming",
    })),
    nextLabel: next.label,
    nextHref: next.path(caseId),
    documentsHref: `/cases/${caseId}/documents`,
    notes,
  };
}

function currentStage(snapshot: JourneySnapshot): JourneyStage {
  const status = snapshot.status ?? "";
  if (!status || INTAKE_STATUSES.has(status)) return "intake";
  if (RESEARCH_STATUSES.has(status)) return "research";

  const selected = snapshot.selectedCount ?? 0;
  if (selected === 0) return "shortlist";

  const contacts = snapshot.contacts;
  if (!contacts) return "consent";

  if (contacts.some((contact) => contact.consented !== true)) return "consent";

  const sent = contacts.some((contact) => contact.state && contact.state !== "drafted");
  const waiting = contacts.some((contact) => contact.approved !== true);
  if ((snapshot.openTaskCount ?? 0) > 0 || sent) return "tracker";
  if (waiting) return "outreach";
  return "tracker";
}

export const GOAL_LABELS: Record<string, string> = {
  second_opinion: "Second opinion",
  treatment: "Care at a center",
  trial: "Trial screening",
  support: "Advocacy support",
  aid: "Financial or travel aid",
};

export type CaseSummary = {
  diseaseName: string;
  subtype: string | null;
  stageSummary: string | null;
  location: string | null;
  insurer: string | null;
  goals: string[];
  status: string;
};

export function summarizeCase(value: unknown): CaseSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = record.case && typeof record.case === "object" ? (record.case as Record<string, unknown>) : record;
  if (typeof nested.diseaseName !== "string" || nested.diseaseName.length === 0) return null;
  const goals = Array.isArray(nested.goals) ? nested.goals.filter((goal): goal is string => typeof goal === "string") : [];
  const city = typeof nested.homeCity === "string" ? nested.homeCity : "";
  const state = typeof nested.homeState === "string" ? nested.homeState : "";
  const location = [city, state].filter(Boolean).join(", ");
  return {
    diseaseName: nested.diseaseName,
    subtype: typeof nested.subtype === "string" && nested.subtype ? nested.subtype : null,
    stageSummary: typeof nested.stageSummary === "string" && nested.stageSummary ? nested.stageSummary : null,
    location: location || null,
    insurer: typeof nested.insurer === "string" && nested.insurer ? nested.insurer : null,
    goals,
    status: typeof nested.status === "string" ? nested.status : "",
  };
}

export function countSelected(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const groups = (value as { groups?: unknown }).groups;
  if (!groups || typeof groups !== "object") return null;
  let count = 0;
  for (const list of Object.values(groups)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === "object" && (item as { selected?: unknown }).selected === true) count += 1;
    }
  }
  return count;
}

export function readContacts(value: unknown): JourneyContact[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { contacts?: unknown }).contacts;
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => {
    const contact = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      consented: typeof contact.consented === "boolean" ? contact.consented : null,
      approved: typeof contact.approved === "boolean" ? contact.approved : null,
      state: typeof contact.state === "string" ? contact.state : null,
    };
  });
}

export function readOpenTaskCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { openTaskCount?: unknown; tasks?: unknown };
  if (typeof record.openTaskCount === "number") return record.openTaskCount;
  if (!Array.isArray(record.tasks)) return null;
  return record.tasks.filter((task) => task && typeof task === "object" && (task as { status?: unknown }).status === "open").length;
}
