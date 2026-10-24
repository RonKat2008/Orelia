"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PatientStatus, PatientTimelineItem } from "@/lib/patient-status/types";

export interface PatientStatusBody {
  caseId: string;
  status: PatientStatus;
  timeline: PatientTimelineItem[];
}

export type LiveMode = "connecting" | "live" | "polling";

const POLL_MS = 10_000;
const RETRY_STREAM_MS = 60_000;
const MAX_STREAM_ERRORS = 3;

function isBody(value: unknown): value is PatientStatusBody {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return !!status && typeof status === "object" && typeof (status as { headline?: unknown }).headline === "string";
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Live patient status: SSE from /patient-status/stream, falling back to polling GET /patient-status every 10s
 * when the stream keeps failing (and trying the stream again a minute later). `refresh()` re-reads at once,
 * for right after the patient does something.
 */
export function usePatientStatus(caseId: string): {
  body: PatientStatusBody | null;
  error: string | null;
  missing: boolean;
  mode: LiveMode;
  refresh: () => Promise<void>;
} {
  const [body, setBody] = useState<PatientStatusBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<LiveMode>("connecting");
  const tz = useRef(timeZone());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/cases/${caseId}/patient-status?tz=${encodeURIComponent(tz.current)}`, { cache: "no-store" });
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      if (!response.ok) {
        setError("We couldn't check for updates just now. We'll keep trying.");
        return;
      }
      const data: unknown = await response.json();
      if (isBody(data)) {
        setBody(data);
        setError(null);
      }
    } catch {
      setError("We couldn't check for updates just now. We'll keep trying.");
    }
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let errors = 0;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pollTimer = null;
      retryTimer = null;
    };

    const startPolling = () => {
      if (cancelled || pollTimer) return;
      setMode("polling");
      void refresh();
      pollTimer = setInterval(() => void refresh(), POLL_MS);
      retryTimer = setTimeout(() => {
        stopPolling();
        openStream();
      }, RETRY_STREAM_MS);
    };

    const openStream = () => {
      if (cancelled) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      errors = 0;
      source = new EventSource(`/api/cases/${caseId}/patient-status/stream?tz=${encodeURIComponent(tz.current)}`);
      source.addEventListener("status", (event) => {
        errors = 0;
        try {
          const data: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (isBody(data)) {
            setBody(data);
            setError(null);
            setMode("live");
          }
        } catch {
          // A malformed event is skipped; the next one replaces it.
        }
      });
      source.addEventListener("failure", () => {
        setError("We couldn't check for updates just now. We'll keep trying.");
      });
      source.addEventListener("gone", () => {
        setMissing(true);
        source?.close();
      });
      source.onerror = () => {
        errors += 1;
        // A normal end of stream also lands here and EventSource reconnects by itself; only give up on repeats.
        if (errors >= MAX_STREAM_ERRORS || source?.readyState === EventSource.CLOSED) {
          source?.close();
          source = null;
          startPolling();
        }
      };
    };

    // A hidden tab holds no stream open; coming back re-reads at once and reconnects.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        source?.close();
        source = null;
        stopPolling();
      } else if (!source && !pollTimer) {
        void refresh();
        openStream();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    openStream();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      source?.close();
      stopPolling();
    };
  }, [caseId, refresh]);

  return { body, error, missing, mode, refresh };
}
