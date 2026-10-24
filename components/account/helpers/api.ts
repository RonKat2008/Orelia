/** Tiny same-origin JSON client for the account endpoints. Never logs payloads (PHI hygiene). */

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  message: string | null;
  issues: { path: string; message: string }[];
}

interface ErrorBody {
  error?: string;
  message?: string;
  issues?: { path: string; message: string }[];
}

export async function apiRequest<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init ?? {};
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    let body: unknown = null;
    if (res.status !== 204) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    if (res.ok) return { ok: true, status: res.status, data: body as T, error: null, message: null, issues: [] };
    const err = (body ?? {}) as ErrorBody;
    return {
      ok: false,
      status: res.status,
      data: null,
      error: err.error ?? "request_failed",
      message: err.message ?? null,
      issues: Array.isArray(err.issues) ? err.issues : [],
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "network", message: "We could not reach Wayfinder. Check your connection and try again.", issues: [] };
  }
}
