export type DeleteCaseResult = { ok: true } | { ok: false; message: string };

/** DELETE /api/cases/[id]. A 404 counts as success from the patient's side: the case is already gone. */
export async function deleteCase(caseId: string, doFetch: typeof fetch = fetch): Promise<DeleteCaseResult> {
  try {
    const res = await doFetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: "DELETE" });
    if (res.ok || res.status === 404) return { ok: true };
    if (res.status === 429) return { ok: false, message: "Too many deletions just now. Please wait a few minutes and try again." };
    return { ok: false, message: "We could not delete this case. Please try again." };
  } catch {
    return { ok: false, message: "We could not reach the server. Check your connection and try again." };
  }
}
