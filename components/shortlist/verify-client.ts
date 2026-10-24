import {
  verificationRequestSchema,
  verificationsResponseSchema,
  type VerificationRequest,
  type VerificationsResponse,
} from "@/lib/verification/contract";

export type VerifyResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string; reasons: string[] };

type Fetch = typeof fetch;
const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/verifications`;

async function body(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failure(status: number, data: unknown): VerifyResult<never> {
  const record = (data ?? {}) as { error?: unknown; reasons?: unknown };
  const error = record.error;
  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? (error as { message: string }).message
        : status === 409
          ? "This request already moved on. Close this and try again."
          : "Something went wrong. Nobody was called.";
  const reasons = Array.isArray(record.reasons) ? record.reasons.filter((r): r is string => typeof r === "string") : [];
  return { ok: false, status, message, reasons };
}

async function requestOf(res: Response): Promise<VerifyResult<VerificationRequest>> {
  const data = await body(res);
  if (!res.ok) return failure(res.status, data);
  const parsed = verificationRequestSchema.safeParse((data as { request?: unknown } | null)?.request);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, status: 502, message: "The call details came back in an unexpected shape.", reasons: [] };
}

const post = (payload: unknown): RequestInit => ({
  method: "POST",
  credentials: "same-origin",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

export async function prepareVerification(
  caseId: string,
  payload: { resourceKey: string; sharedFields: ("diseaseName" | "insurer")[] },
  f: Fetch = fetch,
): Promise<VerifyResult<VerificationRequest>> {
  try {
    return await requestOf(await f(base(caseId), post(payload)));
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Nobody was called.", reasons: [] };
  }
}

export async function approveVerification(
  caseId: string,
  verificationId: string,
  f: Fetch = fetch,
): Promise<VerifyResult<VerificationRequest>> {
  try {
    return await requestOf(await f(`${base(caseId)}/${encodeURIComponent(verificationId)}/approve`, post({})));
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Check the status before trying again.", reasons: [] };
  }
}

/** Fails soft: any error or unexpected shape means no badges, never a broken page. */
export async function loadVerifications(caseId: string, f: Fetch = fetch): Promise<VerificationsResponse | null> {
  try {
    const res = await f(base(caseId), { credentials: "same-origin" });
    if (!res.ok) return null;
    const parsed = verificationsResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Insurer name from the case, or null. Failure simply hides the optional checkbox. */
export async function loadInsurer(caseId: string, f: Fetch = fetch): Promise<string | null> {
  try {
    const res = await f(`/api/cases/${encodeURIComponent(caseId)}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = (await res.json()) as { case?: { insurer?: unknown }; insurer?: unknown };
    const value = data.case?.insurer ?? data.insurer;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
