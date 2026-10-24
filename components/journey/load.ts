import {
  countSelected,
  readContacts,
  readOpenTaskCount,
  readPlanStatus,
  readTasks,
  summarizeCase,
  type CaseSummary,
  type JourneyContact,
  type JourneyPlanStatus,
  type JourneyTask,
} from "./model";

export type JourneyData = {
  summary: CaseSummary | null;
  status: string | null;
  selectedCount: number | null;
  openTaskCount: number | null;
  contacts: JourneyContact[] | null;
  tasks: JourneyTask[] | null;
  planStatus: JourneyPlanStatus | null;
  missingCase: boolean;
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function loadJourney(caseId: string, fetchImpl: typeof fetch = fetch): Promise<JourneyData> {
  const empty: JourneyData = {
    summary: null,
    status: null,
    selectedCount: null,
    openTaskCount: null,
    contacts: null,
    tasks: null,
    planStatus: null,
    missingCase: false,
  };

  try {
    const caseResponse = await fetchImpl(`/api/cases/${caseId}`);
    if (caseResponse.status === 404) return { ...empty, missingCase: true };
    if (!caseResponse.ok) return empty;
    const summary = summarizeCase(await readJson(caseResponse));
    const status = summary?.status ?? null;

    const shortlistResponse = await fetchImpl(`/api/cases/${caseId}/shortlist`).catch(() => null);
    const selectedCount =
      shortlistResponse && shortlistResponse.ok ? countSelected(await readJson(shortlistResponse)) : null;

    const contactsResponse = await fetchImpl(`/api/cases/${caseId}/contacts`).catch(() => null);
    let contacts: JourneyContact[] | null = null;
    let openTaskCount: number | null = null;
    let tasks: JourneyTask[] | null = null;
    if (contactsResponse && contactsResponse.ok) {
      const body = await readJson(contactsResponse);
      contacts = readContacts(body);
      openTaskCount = readOpenTaskCount(body);
    }
    const tasksResponse = await fetchImpl(`/api/cases/${caseId}/tasks`).catch(() => null);
    if (tasksResponse && tasksResponse.ok) {
      tasks = readTasks(await readJson(tasksResponse));
    }

    const planResponse = await fetchImpl(`/api/cases/${caseId}/plan?optional=1`).catch(() => null);
    const planStatus = planResponse && planResponse.ok ? readPlanStatus(await readJson(planResponse)) : null;

    return { summary, status, selectedCount, openTaskCount, contacts, tasks, planStatus, missingCase: false };
  } catch {
    return empty;
  }
}
