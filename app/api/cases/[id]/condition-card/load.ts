import type { Case } from "@/lib/contracts/case";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import { getConditionBriefStore } from "@/lib/condition-brief/store";
import type { JudgeResult } from "@/lib/contracts/judge";
import { getNeedsStore } from "@/lib/agents/needs/store";
import type { HistoryDocument, HistoryEvent } from "@/lib/history";
import { getHistoryStore } from "@/lib/history";
import type { Persist } from "@/lib/agents/persist";
import { buildConditionCard, nearestCare, type ConditionCard } from "@/lib/rare-disease/condition-facts";
import { buildSymptomSummary, type SymptomSummary } from "@/lib/rare-disease/symptom-summary";
import { buildTravelHelp, type TravelHelp, type TravelOrganization } from "@/lib/rare-disease/travel-help";

/** GET /api/cases/[id]/condition-card response body. */
export interface ConditionCardResponse {
  card: ConditionCard;
  /** Only for undiagnosed cases: quotes from the patient's own words and documents. */
  symptoms: SymptomSummary | null;
  travel: TravelHelp;
}

export interface ConditionCardDeps {
  loadBrief(caseId: string): Promise<ConditionBrief | null>;
  loadJudge(caseId: string): Promise<JudgeResult | null>;
  listDocuments(caseId: string): Promise<HistoryDocument[]>;
  listEvents(caseId: string): Promise<HistoryEvent[]>;
  persist: Pick<Persist, "getShortlist" | "getShortlistMeta">;
}

export function defaultDeps(persist: ConditionCardDeps["persist"]): ConditionCardDeps {
  return {
    loadBrief: (id) => getConditionBriefStore().latest(id),
    loadJudge: (id) => getNeedsStore().loadJudge(id),
    listDocuments: (id) => getHistoryStore().listDocuments(id),
    listEvents: (id) => getHistoryStore().listEvents(id),
    persist,
  };
}

/** Additive sources never fail the card: a store error reads as "nothing yet" (logged by the caller's store). */
async function orNull<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

async function loadOrganizations(caseId: string, persist: ConditionCardDeps["persist"]): Promise<TravelOrganization[]> {
  const [items, meta] = await Promise.all([persist.getShortlist(caseId), persist.getShortlistMeta(caseId)]);
  const kindById = new Map(meta.filter((m) => m.targetKind === "organization").map((m) => [m.targetId, m.organizationKind]));
  return items
    .filter((i) => i.targetKind === "organization")
    .map((i) => ({ targetId: i.targetId, name: i.name, organizationKind: kindById.get(i.targetId) ?? null, evidence: i.evidence }));
}

export async function loadConditionCard(found: Case, deps: ConditionCardDeps): Promise<ConditionCardResponse> {
  const caseId = found.id;
  const undiagnosed = found.undiagnosed === true;
  const [brief, judge, organizations, documents, events] = await Promise.all([
    undiagnosed ? Promise.resolve(null) : orNull(() => deps.loadBrief(caseId), null),
    orNull(() => deps.loadJudge(caseId), null),
    orNull(() => loadOrganizations(caseId, deps.persist), []),
    undiagnosed ? orNull(() => deps.listDocuments(caseId), []) : Promise.resolve([]),
    undiagnosed ? orNull(() => deps.listEvents(caseId), []) : Promise.resolve([]),
  ]);
  const card = buildConditionCard({ caseId, case: found, brief, judge });
  const symptoms = undiagnosed ? buildSymptomSummary({ caseId, symptomNotes: found.symptomNotes, documents, events }) : null;
  const travel = buildTravelHelp({ organizations, nearest: nearestCare(judge) });
  return { card, symptoms, travel };
}
