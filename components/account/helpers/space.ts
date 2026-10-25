/** Which document space a component talks to. No scope = the signed-in account library. */
export interface SpaceScope {
  caseId?: string;
  draft?: boolean;
}

/** "" | "?case=ID" | "?draft=1". Appended to every /api/account/documents URL. */
export function spaceQuery(scope?: SpaceScope): string {
  if (scope?.caseId) return `?case=${encodeURIComponent(scope.caseId)}`;
  if (scope?.draft) return "?draft=1";
  return "";
}

/** Base URL for the documents collection in this scope. */
export function docsUrl(scope: SpaceScope | undefined, path = ""): string {
  return `/api/account/documents${path}${spaceQuery(scope)}`;
}
