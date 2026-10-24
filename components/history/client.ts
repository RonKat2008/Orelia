import { z } from "zod";
import {
  conflictSchema,
  eventKindSchema,
  historyDocumentSchema,
  historyEventSchema,
  type AddRecordBody,
  type CreateShareBody,
  type HistorySearchHit,
  type HistoryShare,
  type HistoryTimeline,
  type ShareSection,
} from "@/lib/history/contract";
import type { ListedShare } from "./model";

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };
type Fetch = typeof fetch;

const timelineSchema = z.object({
  documents: z.array(historyDocumentSchema.omit({ text: true })),
  events: z.array(historyEventSchema),
  conflicts: z.array(conflictSchema),
});
const hitSchema = z.object({
  sourceDocId: z.string(),
  docTitle: z.string(),
  eventId: z.string().nullable(),
  kind: eventKindSchema.nullable(),
  date: z.string().nullable(),
  snippet: z.string(),
  score: z.number(),
  match: z.enum(["keyword", "semantic", "both"]),
});
const shareSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  sections: z.array(z.string()),
  label: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
});
const listedShareSchema = shareSchema.extend({ status: z.enum(["active", "expired", "revoked"]) });

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/history`;
const GENERIC = "Something went wrong. Your records were not changed.";

async function call<T>(f: Fetch, url: string, parse: (body: unknown) => T | null, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Your records were not changed." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    const message =
      typeof error === "string"
        ? error
        : typeof (error as { message?: unknown } | null)?.message === "string"
          ? (error as { message: string }).message
          : res.status === 413
            ? "That record is too long."
            : GENERIC;
    return { ok: false, status: res.status, message };
  }
  const data = parse(body);
  return data === null
    ? { ok: false, status: 502, message: "The server answered in an unexpected shape." }
    : { ok: true, data };
}

const pick = <T>(schema: z.ZodType<T>, key: string) => (body: unknown): T | null => {
  const parsed = schema.safeParse((body as Record<string, unknown> | null)?.[key]);
  return parsed.success ? parsed.data : null;
};
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const getTimeline = (caseId: string, f: Fetch = fetch) =>
  call<HistoryTimeline>(f, base(caseId), pick(timelineSchema, "timeline"));

export const addRecord = (caseId: string, body: AddRecordBody, f: Fetch = fetch) =>
  call<HistoryTimeline>(f, base(caseId), pick(timelineSchema, "timeline"), json("POST", body));

export const deleteDocument = (caseId: string, docId: string, f: Fetch = fetch) =>
  call<HistoryTimeline>(f, `${base(caseId)}/documents/${encodeURIComponent(docId)}`, pick(timelineSchema, "timeline"), { method: "DELETE" });

export const searchHistory = (caseId: string, q: string, f: Fetch = fetch) =>
  call<HistorySearchHit[]>(f, `${base(caseId)}/search?q=${encodeURIComponent(q)}`, pick(z.array(hitSchema), "results"));

export const loadSample = (caseId: string, slug: string, f: Fetch = fetch) =>
  call<HistoryTimeline>(f, `${base(caseId)}/sample`, pick(timelineSchema, "timeline"), json("POST", { slug }));

export const listShares = (caseId: string, f: Fetch = fetch) =>
  call<ListedShare[]>(f, `${base(caseId)}/share`, (body) => {
    const parsed = z.array(listedShareSchema).safeParse((body as { shares?: unknown } | null)?.shares);
    return parsed.success ? (parsed.data as ListedShare[]) : null;
  });

export const createShare = (caseId: string, body: CreateShareBody, f: Fetch = fetch) =>
  call<{ share: HistoryShare; url: string }>(f, `${base(caseId)}/share`, (res) => {
    const parsed = z.object({ share: shareSchema, url: z.string().min(1) }).safeParse(res);
    return parsed.success ? { share: parsed.data.share as HistoryShare, url: parsed.data.url } : null;
  }, json("POST", body));

export const revokeShare = (caseId: string, shareId: string, f: Fetch = fetch) =>
  call<HistoryShare>(f, `${base(caseId)}/share/${encodeURIComponent(shareId)}`, pick(shareSchema, "share") as (b: unknown) => HistoryShare | null, { method: "DELETE" });

export type { ShareSection };
