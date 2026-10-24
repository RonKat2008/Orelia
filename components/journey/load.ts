import {
  countSelected,
  readContacts,
  readOpenTaskCount,
  summarizeCase,
  type CaseSummary,
  type JourneyContact,
} from "./model";

export type JourneyData = {
  summary: CaseSummary | null;
  status: string | null;
  selectedCount: number | null;
  openTaskCount: number | null;
  contacts: JourneyContact[] | null;
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
    if (contactsResponse && contactsResponse.ok) {
      const body = await readJson(contactsResponse);
      contacts = readContacts(body);
      openTaskCount = readOpenTaskCount(body);
    }

    return { summary, status, selectedCount, openTaskCount, contacts, missingCase: false };
  } catch {
    return empty;
  }
}
