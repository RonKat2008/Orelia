import type { CaseInput } from "@/lib/contracts";

const SELECTED_KEY = (caseId: string) => `wayfinder.selected.${caseId}`;
const OUTREACH_KEY = (caseId: string) => `wayfinder.outreach.${caseId}`;

export type ApiContact = {
  id: string;
  caseId: string;
  targetId: string;
  targetKind: string;
  channel: "email" | "voice";
  address: string;
  state: string;
  purpose?: string;
};

export type UnavailableContact = {
  candidateId: string;
  channel: "none";
  reason: string;
};

export type StoredOutreach = {
  contacts: ApiContact[];
  unavailable: UnavailableContact[];
};

export type ApiDraft = {
  id: string;
  contactId: string;
  channel: "email" | "voice";
  address: string;
  subject?: string;
  body: string;
  sharedFields: string[];
  approvedAt?: string | null;
};

export const REFUSAL_LABELS: Record<string, string> = {
  not_approved: "This draft does not have an approval timestamp.",
  not_allowlisted: "The address is not on the outbound allowlist, so nothing can be sent.",
  contact_cap: "This case is already at the five active-contact limit.",
  follow_up_cadence: "A follow-up is not allowed yet.",
  unshared_field: "The draft includes a case field you did not agree to share.",
  missing_disclosure: "The AI-assistance disclosure is missing.",
  medical_advice: "The draft appears to give medical advice.",
  invalid_draft: "The draft is not valid.",
  consent_mismatch: "Consent changed after this draft was written.",
  inactive_contact: "This contact is no longer active.",
  consent_required: "Save what this contact may see before drafting or approving.",
  channel_unavailable: "No send channel is available.",
  already_approved: "This draft was already approved.",
  already_approved_or_consent_changed: "Approval was already reserved, or consent changed.",
  invalid_request: "The request was rejected as invalid.",
  outreach_unavailable: "Outreach could not be saved. Nothing was sent.",
  case_not_found: "This case was not found.",
  candidate_not_found: "One of the selected resources was not found.",
  contact_not_found: "This contact was not found.",
  draft_not_found: "This draft was not found.",
};

export function readSelectedCandidateIds(caseId: string, storage: Pick<Storage, "getItem"> = sessionStorage): string[] {
  const raw = storage.getItem(SELECTED_KEY(caseId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string").slice(0, 5);
  } catch {
    return [];
  }
}

export function readStoredOutreach(caseId: string, storage: Pick<Storage, "getItem"> = sessionStorage): StoredOutreach | null {
  const raw = storage.getItem(OUTREACH_KEY(caseId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredOutreach;
    if (!parsed || !Array.isArray(parsed.contacts)) return null;
    return {
      contacts: parsed.contacts.filter(isApiContact),
      unavailable: Array.isArray(parsed.unavailable) ? parsed.unavailable.filter(isUnavailable) : [],
    };
  } catch {
    return null;
  }
}

export function writeStoredOutreach(
  caseId: string,
  value: StoredOutreach,
  storage: Pick<Storage, "setItem"> = sessionStorage,
) {
  storage.setItem(OUTREACH_KEY(caseId), JSON.stringify(value));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wayfinder-outreach"));
}

export function subscribeOutreach(onChange: () => void) {
  window.addEventListener("wayfinder-outreach", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("wayfinder-outreach", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function outreachSnapshot(caseId: string): string | null {
  return sessionStorage.getItem(OUTREACH_KEY(caseId));
}

export function selectBody(caseId: string, candidateIds: readonly string[]) {
  return { caseId, candidateIds: [...candidateIds] };
}

export function consentBody(sharedFields: readonly string[]) {
  return { sharedFields: [...sharedFields] };
}

/** Approval accepts only the draft id. The server sets approved_at. */
export function approvalBody(draftId: string) {
  return { draftId };
}

export function refusalMessages(reasons: unknown): string[] {
  const list = Array.isArray(reasons) ? reasons : [];
  const messages = list
    .filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
    .map((reason) => REFUSAL_LABELS[reason] ?? reason);
  return messages.length > 0 ? messages : ["The server refused this action and did not confirm it."];
}

export type ApproveSuccess = { ok: true; approvedAt: string; sentAt: string | null };
export type ApproveFailure = { ok: false; status: number; reasons: string[] };

export async function selectOutreach(
  caseId: string,
  candidateIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; value: StoredOutreach } | ApproveFailure> {
  const response = await fetchImpl("/api/outreach/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selectBody(caseId, candidateIds)),
  });
  const data = await readJson(response);
  if (!response.ok) return { ok: false, status: response.status, reasons: refusalMessages(data.reasons) };
  const contacts = Array.isArray(data.contacts) ? data.contacts.filter(isApiContact) : [];
  const unavailable = Array.isArray(data.unavailable) ? data.unavailable.filter(isUnavailable) : [];
  return { ok: true, value: { contacts, unavailable } };
}

export async function saveContactConsent(
  contactId: string,
  sharedFields: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | ApproveFailure> {
  const response = await fetchImpl(`/api/contacts/${contactId}/consent`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(consentBody(sharedFields)),
  });
  const data = await readJson(response);
  if (!response.ok) return { ok: false, status: response.status, reasons: refusalMessages(data.reasons) };
  return { ok: true };
}

export async function createContactDraft(
  contactId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; draft: ApiDraft } | ApproveFailure> {
  const response = await fetchImpl(`/api/contacts/${contactId}/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const data = await readJson(response);
  if (!response.ok) return { ok: false, status: response.status, reasons: refusalMessages(data.reasons) };
  if (!isApiDraft(data)) {
    return { ok: false, status: response.status, reasons: ["The server did not return a draft."] };
  }
  return { ok: true, draft: data };
}

export async function approveContactDraft(
  contactId: string,
  draftId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApproveSuccess | ApproveFailure> {
  const response = await fetchImpl(`/api/contacts/${contactId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(approvalBody(draftId)),
  });
  const data = await readJson(response);
  if (!response.ok) return { ok: false, status: response.status, reasons: refusalMessages(data.reasons) };
  if (typeof data.approvedAt !== "string") {
    return { ok: false, status: response.status, reasons: ["The server did not confirm approval. Nothing is marked approved."] };
  }
  return { ok: true, approvedAt: data.approvedAt, sentAt: typeof data.sentAt === "string" ? data.sentAt : null };
}

export type TaskApproval =
  | { available: true; approved: true }
  | { available: true; approved: false; reasons: string[] }
  | { available: false; reasons: string[] };

/** Feature-detects POST /api/tasks/[id]/approve. A missing route is not an approval. */
export async function approveTask(taskId: string, fetchImpl: typeof fetch = fetch): Promise<TaskApproval> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/tasks/${taskId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    return { available: false, reasons: ["Task approval is not available yet. This task is still open."] };
  }
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    return { available: false, reasons: ["Task approval is not available yet. This task is still open."] };
  }
  const data = await readJson(response);
  if (!response.ok) return { available: true, approved: false, reasons: refusalMessages(data.reasons) };
  return { available: true, approved: true };
}

export async function loadCase(caseId: string, fetchImpl: typeof fetch = fetch): Promise<CaseInput | null> {
  const response = await fetchImpl(`/api/cases/${caseId}`);
  if (!response.ok) return null;
  const data = await readJson(response);
  const record = data.case;
  if (!record || typeof record !== "object") return null;
  const caseRecord = record as CaseInput;
  if (typeof caseRecord.diseaseName !== "string") return null;
  return caseRecord;
}

export function contactLabel(contact: ApiContact): string {
  const kind = contact.targetKind.replaceAll("_", " ");
  const purpose = contact.purpose ? contact.purpose.replaceAll("_", " ") : null;
  return purpose ? `${purpose} (${kind})` : kind;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data = (await response.json()) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isApiContact(value: unknown): value is ApiContact {
  if (!value || typeof value !== "object") return false;
  const contact = value as ApiContact;
  return (
    typeof contact.id === "string" &&
    (contact.channel === "email" || contact.channel === "voice") &&
    typeof contact.address === "string" &&
    typeof contact.targetKind === "string"
  );
}

function isUnavailable(value: unknown): value is UnavailableContact {
  if (!value || typeof value !== "object") return false;
  const item = value as UnavailableContact;
  return item.channel === "none" && typeof item.candidateId === "string";
}

function isApiDraft(value: unknown): value is ApiDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as ApiDraft;
  return typeof draft.id === "string" && (draft.channel === "email" || draft.channel === "voice") && typeof draft.body === "string";
}
