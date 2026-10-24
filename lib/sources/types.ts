import type { Evidence } from "../contracts/evidence";
export interface SourceResult<T> { records: T[]; evidence: Evidence[] }
export function evidence(sourceKind: Evidence["sourceKind"], sourceUrl: string, fetchedAt: string, claimType: string, claim: string): Evidence {
  return { sourceKind, sourceUrl, fetchedAt, claimType, claim };
}
