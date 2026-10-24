export type ApprovalRequest = {
  contactId: string;
  draftId?: string;
  taskId?: string;
  approvedAt?: string;
};

export type ApprovalResult = {
  approvedAt: string;
  source: "api" | "local";
};

/**
 * POST /api/contacts/[id]/approve. That route belongs to another lane.
 * When it is missing or errors, the timestamp is kept locally so the patient
 * can still record approval in this UI.
 */
export async function requestApproval(
  request: ApprovalRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalResult> {
  const approvedAt = request.approvedAt ?? new Date().toISOString();
  try {
    const response = await fetchImpl(`/api/contacts/${request.contactId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftId: request.draftId,
        taskId: request.taskId,
        approvedAt,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { approvedAt?: unknown };
      return {
        approvedAt: typeof data.approvedAt === "string" ? data.approvedAt : approvedAt,
        source: "api",
      };
    }
  } catch {
    // The approve route is not on this branch yet.
  }
  return { approvedAt, source: "local" };
}
