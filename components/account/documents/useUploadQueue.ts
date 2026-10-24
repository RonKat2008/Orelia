"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { apiRequest } from "../helpers/api";
import { resolveContentType } from "../helpers/files";
import { draftForFile, metadataFromDraft, type MetadataDraft } from "../helpers/metadata";

export const MAX_CONCURRENT_UPLOADS = 3;
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

export type UploadPhase = "staged" | "queued" | "creating" | "uploading" | "processing" | "failed";

export interface UploadItem {
  key: string;
  file: File;
  draft: MetadataDraft;
  fieldErrors: Partial<Record<keyof MetadataDraft, string>>;
  phase: UploadPhase;
  /** 0-100 while uploading. */
  progress: number;
  error: string | null;
  docId: string | null;
  pathname: string | null;
  blobDone: boolean;
}

const ACTIVE: ReadonlySet<UploadPhase> = new Set(["creating", "uploading", "processing"]);
export const isActivePhase = (phase: UploadPhase) => ACTIVE.has(phase);

function friendlyCreateError(status: number, message: string | null): string {
  if (status === 413) return "That file is too large.";
  if (status === 415) return "That file type is not supported.";
  if (status === 401 || status === 404) return "Your session ended. Sign in again to upload.";
  return message ?? "We could not start the upload. Please try again.";
}

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

let keyCounter = 0;
const nextKey = () => `upload-${Date.now().toString(36)}-${keyCounter++}`;

/** Staged files + an upload pipeline (create -> blob upload -> process) with at most 3 files in flight. */
export function useUploadQueue(onDocument: (doc: LibraryDocument) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const onDocumentRef = useRef(onDocument);
  useEffect(() => {
    onDocumentRef.current = onDocument;
  }, [onDocument]);

  const commit = useCallback((updater: (prev: UploadItem[]) => UploadItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  const patch = useCallback(
    (key: string, change: Partial<UploadItem>) =>
      commit((prev) => prev.map((item) => (item.key === key ? { ...item, ...change } : item))),
    [commit],
  );

  const pumpRef = useRef<() => void>(() => undefined);

  const run = useCallback(
    async (key: string) => {
      const find = () => itemsRef.current.find((item) => item.key === key);
      let item = find();
      if (!item) return;
      try {
        if (!item.docId) {
          patch(key, { phase: "creating", error: null, progress: 0 });
          const meta = metadataFromDraft(item.draft);
          const contentType = resolveContentType(item.file);
          if (!meta.ok || !contentType) {
            patch(key, { phase: "staged", fieldErrors: meta.ok ? {} : meta.errors, error: meta.ok ? "That file type is not supported." : null });
            return;
          }
          const created = await apiRequest<{ document: LibraryDocument; upload: { pathname: string } }>("/api/account/documents", {
            method: "POST",
            json: { ...meta.value, fileName: item.file.name, contentType, sizeBytes: item.file.size },
          });
          if (!created.ok || !created.data) {
            patch(key, { phase: "failed", error: friendlyCreateError(created.status, created.message) });
            return;
          }
          patch(key, { docId: created.data.document.id, pathname: created.data.upload.pathname });
          onDocumentRef.current(created.data.document);
          item = find();
          if (!item) return;
        }

        if (!item.blobDone && item.pathname && item.docId) {
          patch(key, { phase: "uploading", error: null, progress: 0 });
          const contentType = item.file.type || resolveContentType(item.file) || undefined;
          try {
            await upload(item.pathname, item.file, {
              access: "private",
              handleUploadUrl: "/api/account/documents/upload",
              clientPayload: item.docId,
              contentType,
              multipart: item.file.size > MULTIPART_THRESHOLD,
              onUploadProgress: ({ percentage }) => patch(key, { progress: Math.round(percentage) }),
              // Without a ceiling a blocked or dropped connection retries forever at 0%.
              abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
            });
          } catch {
            patch(key, { phase: "failed", error: "The upload did not finish. Check your connection and retry." });
            return;
          }
          patch(key, { blobDone: true, progress: 100 });
        }

        patch(key, { phase: "processing", error: null });
        const processed = await apiRequest<{ document: LibraryDocument }>(`/api/account/documents/${item.docId}/process`, { method: "POST" });
        if (!processed.ok || !processed.data) {
          patch(key, { phase: "failed", error: processed.message ?? "We could not read this file. Retry in a moment." });
          return;
        }
        onDocumentRef.current(processed.data.document);
        commit((prev) => prev.filter((candidate) => candidate.key !== key));
      } finally {
        pumpRef.current();
      }
    },
    [commit, patch],
  );

  const pump = useCallback(() => {
    let active = itemsRef.current.filter((item) => isActivePhase(item.phase)).length;
    for (const item of itemsRef.current) {
      if (active >= MAX_CONCURRENT_UPLOADS) break;
      if (item.phase === "queued") {
        active += 1;
        patch(item.key, { phase: "creating" });
        void run(item.key);
      }
    }
  }, [patch, run]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const addFiles = useCallback(
    (files: File[]) =>
      commit((prev) => [
        ...prev,
        ...files.map<UploadItem>((file) => ({
          key: nextKey(), file, draft: draftForFile(file.name), fieldErrors: {}, phase: "staged", progress: 0,
          error: null, docId: null, pathname: null, blobDone: false,
        })),
      ]),
    [commit],
  );

  const updateDraft = useCallback(
    (key: string, change: Partial<MetadataDraft>) =>
      commit((prev) =>
        prev.map((item) => (item.key === key ? { ...item, draft: { ...item.draft, ...change }, fieldErrors: {} } : item)),
      ),
    [commit],
  );

  const remove = useCallback((key: string) => commit((prev) => prev.filter((item) => item.key !== key)), [commit]);

  /** Validate drafts, then queue. Rows with errors stay staged and show them. */
  const start = useCallback(
    (keys: string[]) => {
      commit((prev) =>
        prev.map((item) => {
          if (!keys.includes(item.key) || (item.phase !== "staged" && item.phase !== "failed")) return item;
          if (item.docId) return { ...item, phase: "queued" as const, error: null };
          const meta = metadataFromDraft(item.draft);
          return meta.ok ? { ...item, phase: "queued" as const, fieldErrors: {}, error: null } : { ...item, fieldErrors: meta.errors };
        }),
      );
      pump();
    },
    [commit, pump],
  );

  const stagedKeys = items.filter((item) => item.phase === "staged").map((item) => item.key);
  const busy = items.some((item) => item.phase !== "staged" && item.phase !== "failed");

  return { items, addFiles, updateDraft, remove, start, stagedKeys, busy };
}
