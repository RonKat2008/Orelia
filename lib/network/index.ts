export interface NetworkQuery { insurer: string; planId: string; providerNpi: string }
export interface DirectoryResult extends NetworkQuery { status: 'yes' | 'no' | 'unknown'; sourceUrl: string; checkedAt: string }
export interface FhirDirectoryPort { lookup(query: NetworkQuery): Promise<DirectoryResult | undefined> }
export type NetworkResult = { status: 'unknown'; reason: string } | DirectoryResult;
function validResult(query: NetworkQuery, result?: DirectoryResult): result is DirectoryResult {
  if (!result || !query.insurer.trim() || !query.planId.trim() || !/^\d{10}$/.test(query.providerNpi)) return false;
  try {
    return ['yes', 'no', 'unknown'].includes(result.status) && ['https:', 'http:'].includes(new URL(result.sourceUrl).protocol) && Number.isFinite(Date.parse(result.checkedAt)) && result.insurer === query.insurer && result.planId === query.planId && result.providerNpi === query.providerNpi;
  } catch { return false; }
}
/** Neither clinician location nor an insurer name establishes plan participation. */
export function inNetwork(query: NetworkQuery, result?: DirectoryResult): NetworkResult {
  return validResult(query, result) ? { ...result } : { status: 'unknown', reason: 'No matching, sourced plan-specific directory result. Confirm with the plan and provider.' };
}
export async function lookupInNetwork(query: NetworkQuery, port?: FhirDirectoryPort): Promise<NetworkResult> {
  try { return inNetwork(query, await port?.lookup(query)); }
  catch { return { status: 'unknown', reason: 'Directory unavailable. Confirm with the plan and provider.' }; }
}
