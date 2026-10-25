"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivitySnapshot } from "@/lib/activity/types";

export type FeedMode = "connecting" | "live" | "polling";

const POLL_MS = 3000;
const SILENT_MS = 20_000;
const WATCHDOG_MS = 5000;
const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 30_000;

export interface Feed {
  snapshot: ActivitySnapshot | null;
  mode: FeedMode;
  /** server clock minus browser clock at the last snapshot, so countdowns survive a wrong local clock. */
  skewMs: number;
  /** Event ids that arrived after the first snapshot (used for the brief highlight). */
  freshIds: ReadonlySet<string>;
}

/**
 * Live feed: EventSource on the stream; falls back to polling the JSON route every 3 s when SSE errors or is silent
 * for 20 s (the server pings every 15 s), and keeps retrying SSE with backoff. The server closes the stream after
 * ~280 s; that surfaces as an error, so we reconnect right away.
 */
export function useActivityFeed(caseId: string, judge: boolean): Feed {
  const [state, setState] = useState<Feed>({ snapshot: null, mode: "connecting", skewMs: 0, freshIds: new Set() });
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSignal = Date.now();
    let lastCursor = "";
    let retryMs = RETRY_MIN_MS;
    const base = `/api/cases/${caseId}/activity`;
    const query = judge ? "?view=judge" : "";
    seen.current = null;

    const apply = (snap: ActivitySnapshot, mode: FeedMode) => {
      lastSignal = Date.now();
      const received = Date.now();
      if (snap.cursor === lastCursor) {
        setState((s) => (s.mode === mode ? s : { ...s, mode }));
        return;
      }
      lastCursor = snap.cursor;
      const known = seen.current;
      const fresh = new Set<string>();
      if (known) for (const e of snap.events) if (!known.has(e.id)) fresh.add(e.id);
      seen.current = new Set(snap.events.map((e) => e.id));
      setState({ snapshot: snap, mode, skewMs: Date.parse(snap.now) - received, freshIds: fresh });
    };

    const pollOnce = async () => {
      try {
        const res = await fetch(`${base}${query}`, { cache: "no-store" });
        if (!res.ok || closed) return;
        apply((await res.json()) as ActivitySnapshot, "polling");
      } catch {
        // Offline or a transient error: the next tick tries again.
      }
    };
    const startPolling = () => {
      if (pollTimer) return;
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const dropStream = () => {
      es?.close();
      es = null;
    };
    const scheduleRetry = (delay: number) => {
      if (closed || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        connect();
      }, delay);
    };

    function connect() {
      if (closed || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      dropStream();
      const source = new EventSource(`${base}/stream${query}`);
      es = source;
      lastSignal = Date.now();
      source.addEventListener("activity", (ev) => {
        try {
          apply(JSON.parse((ev as MessageEvent<string>).data) as ActivitySnapshot, "live");
        } catch {
          return;
        }
        stopPolling();
        retryMs = RETRY_MIN_MS;
      });
      source.addEventListener("ping", () => {
        lastSignal = Date.now();
        stopPolling();
        setState((s) => (s.mode === "live" ? s : { ...s, mode: "live" }));
      });
      source.onerror = () => {
        // Closed by the server (~280 s), a network drop, or a proxy: poll meanwhile and reconnect.
        dropStream();
        startPolling();
        scheduleRetry(retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      };
    }

    const watchdog = setInterval(() => {
      if (es && Date.now() - lastSignal > SILENT_MS) {
        dropStream();
        startPolling();
        scheduleRetry(retryMs);
      }
    }, WATCHDOG_MS);

    connect();
    return () => {
      closed = true;
      dropStream();
      stopPolling();
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [caseId, judge]);

  return state;
}
