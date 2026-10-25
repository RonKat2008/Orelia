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
    // One parallel round instead of five sequential requests: this runs on every stage switch.
    const optional = (url: string) => fetchImpl(url).catch(() => null);
    const [caseResponse, shortlistResponse, contactsResponse, tasksResponse, planResponse] = await Promise.all([
      fetchImpl(`/api/cases/${caseId}`),
      optional(`/api/cases/${caseId}/shortlist`),
      optional(`/api/cases/${caseId}/contacts`),
      optional(`/api/cases/${caseId}/tasks`),
      optional(`/api/cases/${caseId}/plan?optional=1`),
    ]);
    if (caseResponse.status === 404) return { ...empty, missingCase: true };
    if (!caseResponse.ok) return empty;
    const okJson = async (response: Response | null) => (response && response.ok ? readJson(response) : undefined);
    const [caseBody, shortlistBody, contactsBody, tasksBody, planBody] = await Promise.all([
      readJson(caseResponse),
      okJson(shortlistResponse),
      okJson(contactsResponse),
      okJson(tasksResponse),
      okJson(planResponse),
    ]);
    const summary = summarizeCase(caseBody);
    const status = summary?.status ?? null;
    const selectedCount = shortlistBody === undefined ? null : countSelected(shortlistBody);
    const contacts = contactsBody === undefined ? null : readContacts(contactsBody);
    const openTaskCount = contactsBody === undefined ? null : readOpenTaskCount(contactsBody);
    const tasks = tasksBody === undefined ? null : readTasks(tasksBody);
    const planStatus = planBody === undefined ? null : readPlanStatus(planBody);

    return { summary, status, selectedCount, openTaskCount, contacts, tasks, planStatus, missingCase: false };
  } catch {
    return empty;
  }
}
