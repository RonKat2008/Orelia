import { loadLiveCalls, type LiveCallView } from './call-live';

/** Live calls for a case. No database (offline demo) -> no calls rather than an error. */
export async function liveCallsFor(caseId: string, judge: boolean): Promise<LiveCallView[]> {
  if (!process.env.DATABASE_URL) return [];
  return loadLiveCalls(caseId, { judge });
}
