/**
 * Framework-free controller behind the swarm view: an SSE stream with auto-reconnect and backoff, plus a polling
 * fallback so the screen can never freeze. Timers, EventSource and fetch are injected, so tests run on fake clocks.
 */

/** "polling" = the stream is down and the screen is kept fresh by polling while the stream reconnects. */
export type SyncConnection = "connecting" | "live" | "polling" | "lost";

export interface SourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  readonly readyState: number;
}

export interface LiveSyncOptions {
  caseId: string;
  /** Each raw snapshot (the `runs` payload as a JSON string). Source of truth for cards, phases and status. */
  onSnapshot(data: string): void;
  /** The run reached a terminal state (SSE `done`, or a finished poll). */
  onDone(caseStatus: string | undefined): void;
  onConnection(connection: SyncConnection): void;
  /** Offline demo only: nothing arrived, so the caller should play its labelled preview. */
  onPreview?(): void;
  createSource?(url: string): SourceLike;
  fetchStatus?(url: string): Promise<Response>;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
  /** No new snapshot for this long starts polling. */
  staleAfterMs?: number;
  pollEveryMs?: number;
  /** Reconnect delays; the last one repeats. */
  backoffMs?: readonly number[];
  previewAfterMs?: number;
}

export const STALE_AFTER_MS = 20_000;
export const POLL_EVERY_MS = 5_000;
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export function startLiveSync(opts: LiveSyncOptions): { stop(): void } {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = opts.now ?? (() => Date.now());
  const createSource = opts.createSource ?? ((url) => new EventSource(url) as unknown as SourceLike);
  const fetchStatus = opts.fetchStatus ?? ((url) => fetch(url, { cache: "no-store" }));
  const staleAfter = opts.staleAfterMs ?? STALE_AFTER_MS;
  const pollEvery = opts.pollEveryMs ?? POLL_EVERY_MS;
  const backoff = opts.backoffMs ?? BACKOFF_MS;

  let source: SourceLike | null = null;
  let stopped = false;
  let finished = false;
  let sawSnapshot = false;
  let lastSnapshotAt = now();
  let reconnectAttempt = 0;
  let reconnectTimer: unknown;
  let pollTimer: unknown;
  let staleTimer: unknown;
  let previewTimer: unknown;
  let polling = false;
  let connection: SyncConnection = "connecting";

  const setConnection = (next: SyncConnection) => {
    if (next === connection) return;
    connection = next;
    opts.onConnection(next);
  };

  const finish = (status: string | undefined) => {
    if (finished) return;
    finished = true;
    teardown();
    opts.onDone(status);
  };

  const closeSource = () => {
    source?.close();
    source = null;
  };

  function teardown() {
    closeSource();
    for (const t of [reconnectTimer, pollTimer, staleTimer, previewTimer]) if (t !== undefined) clearTimer(t);
    reconnectTimer = pollTimer = staleTimer = previewTimer = undefined;
  }

  const accept = (data: string) => {
    sawSnapshot = true;
    lastSnapshotAt = now();
    opts.onSnapshot(data);
  };

  async function pollOnce() {
    if (stopped || finished) return;
    try {
      const res = await fetchStatus(`/api/cases/${opts.caseId}/status`);
      if (stopped || finished) return;
      if (res.ok) {
        const body = (await res.json()) as { caseStatus?: string; finished?: boolean };
        if (stopped || finished) return;
        accept(JSON.stringify(body));
        if (body.finished) return finish(body.caseStatus);
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        // The case is gone or not ours: polling can never succeed, so say so instead of spinning.
        stopped = true;
        teardown();
        return setConnection("lost");
      }
    } catch {
      // Network trouble: keep the honest "reconnecting" state and try again next tick.
    }
    if (polling) schedulePoll(pollEvery);
  }

  function schedulePoll(delay: number) {
    if (stopped || finished || pollTimer !== undefined) return;
    pollTimer = setTimer(() => {
      pollTimer = undefined;
      void pollOnce();
    }, delay);
  }

  function startPolling() {
    if (polling || stopped || finished) return;
    polling = true;
    setConnection("polling");
    schedulePoll(0); // the user is already looking at a stalled screen: first poll right away
  }

  function stopPolling() {
    polling = false;
    if (pollTimer !== undefined) clearTimer(pollTimer);
    pollTimer = undefined;
  }

  function scheduleReconnect() {
    if (stopped || finished || reconnectTimer !== undefined) return;
    const delay = backoff[Math.min(reconnectAttempt, backoff.length - 1)] ?? 1_000;
    reconnectAttempt += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = undefined;
      if (!stopped && !finished) connect();
    }, delay);
  }

  function onDrop() {
    if (stopped || finished) return;
    closeSource();
    if (opts.onPreview && !sawSnapshot) {
      stopped = true;
      teardown();
      opts.onPreview();
      return;
    }
    startPolling();
    scheduleReconnect();
  }

  function connect() {
    closeSource();
    const src = createSource(`/api/cases/${opts.caseId}/stream`);
    source = src;
    src.addEventListener("runs", (event) => {
      if (src !== source) return;
      reconnectAttempt = 0;
      stopPolling();
      setConnection("live");
      accept((event as MessageEvent<string>).data);
    });
    src.addEventListener("done", (event) => {
      if (src !== source) return;
      let status: string | undefined;
      try {
        status = (JSON.parse((event as MessageEvent<string>).data) as { caseStatus?: string }).caseStatus;
      } catch {
        status = "ready";
      }
      finish(status);
    });
    // Covers both network errors and the server's own `event: error`; either way we recover rather than freeze.
    src.addEventListener("error", () => {
      if (src !== source) return;
      onDrop();
    });
  }

  function watchStale() {
    staleTimer = setTimer(() => {
      staleTimer = undefined;
      if (stopped || finished) return;
      if (now() - lastSnapshotAt >= staleAfter && connection !== "polling") {
        startPolling();
        scheduleReconnect();
      }
      watchStale();
    }, Math.min(5_000, staleAfter));
  }

  connect();
  watchStale();
  if (opts.onPreview) {
    previewTimer = setTimer(() => {
      if (!sawSnapshot && !stopped && !finished) onDrop();
    }, opts.previewAfterMs ?? 6_000);
  }

  return {
    stop() {
      stopped = true;
      teardown();
    },
  };
}
