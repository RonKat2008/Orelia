import { parseThreads, type ContactThread, type ThreadsPayload } from "./model";

export async function loadThreads(caseId: string, fetchImpl: typeof fetch = fetch): Promise<ThreadsPayload & { threads?: ContactThread[] }> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/cases/${encodeURIComponent(caseId)}/threads`);
  } catch {
    return { status: "error" };
  }
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: "error" };
  try {
    const data = (await response.json()) as unknown;
    return { status: "ok", threads: parseThreads(data) };
  } catch {
    return { status: "error" };
  }
}
