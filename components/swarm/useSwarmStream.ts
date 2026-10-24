"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { AgentName } from "@/lib/contracts";
import { playMockStream } from "./preview";
import { startLiveSync, type SyncConnection } from "./liveSync";
import {
  applySwarmEvent,
  initialAgents,
  parseRunsSnapshot,
  sourcesFromShortlist,
  type AgentCardState,
  type PhaseRuns,
  type SourceWithAgent,
  type SwarmEvent,
} from "./stream";

export type Connection = SyncConnection | "preview";

export type SwarmState = {
  cards: AgentCardState[];
  caseStatus?: string;
  connection: Connection;
  lastActive?: AgentName;
  /** Newest first. */
  sources: SourceWithAgent[];
  previewDone: boolean;
  /** Verifier / ranker / curator rows: the post-search stages. */
  phases: PhaseRuns;
  /** serverTime - clientTime at the last snapshot, so phase timers use the server's clock. */
  clockOffsetMs: number;
};

type Action =
  | { type: "runs"; data: string; clientNow: number }
  | { type: "event"; event: SwarmEvent }
  | { type: "status"; caseStatus: string }
  | { type: "connection"; connection: Connection }
  | { type: "preview" }
  | { type: "previewEnd" }
  | { type: "sources"; sources: SourceWithAgent[] }
  | { type: "reset" };

export const INITIAL: SwarmState = {
  cards: initialAgents(),
  connection: "connecting",
  sources: [],
  previewDone: false,
  phases: {},
  clockOffsetMs: 0,
};

function sameCard(a: AgentCardState | undefined, b: AgentCardState): boolean {
  return (
    !!a &&
    a.status === b.status &&
    a.error === b.error &&
    a.outputSummary === b.outputSummary &&
    a.finishedAt === b.finishedAt &&
    JSON.stringify(a.counts) === JSON.stringify(b.counts)
  );
}

function changedAgent(prev: AgentCardState[], next: AgentCardState[]): AgentName | undefined {
  return next.find((card, i) => !sameCard(prev[i], card))?.agent;
}

export function swarmReducer(state: SwarmState, action: Action): SwarmState {
  switch (action.type) {
    case "runs": {
      const snapshot = parseRunsSnapshot(action.data, state.cards);
      if (!snapshot) return state;
      const changed = changedAgent(state.cards, snapshot.cards);
      const serverMs = snapshot.serverTime ? Date.parse(snapshot.serverTime) : NaN;
      return {
        ...state,
        cards: changed ? snapshot.cards : state.cards,
        phases: snapshot.phases,
        caseStatus: snapshot.caseStatus ?? state.caseStatus,
        clockOffsetMs: Number.isNaN(serverMs) ? state.clockOffsetMs : serverMs - action.clientNow,
        lastActive: changed ?? state.lastActive,
      };
    }
    case "event": {
      const cards = applySwarmEvent(state.cards, action.event);
      const added = action.event.sources ?? [];
      return {
        ...state,
        cards,
        lastActive: action.event.agent,
        sources: [...added.map((s) => ({ ...s, agent: action.event.agent })).reverse(), ...state.sources],
      };
    }
    case "status":
      return { ...state, caseStatus: action.caseStatus };
    case "connection":
      return { ...state, connection: action.connection };
    case "preview":
      return { ...INITIAL, connection: "preview" };
    case "previewEnd":
      return { ...state, caseStatus: "ready", previewDone: true };
    case "sources":
      return { ...state, sources: action.sources };
    case "reset":
      return INITIAL;
  }
}

const PREVIEW_AFTER_MS = 6000;

/** Live research swarm: SSE from the stream route, with a labelled typed preview only in offline mode. */
export function useSwarmStream(caseId: string) {
  const [state, dispatch] = useReducer(swarmReducer, INITIAL);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>();

  useEffect(() => {
    let stopMock = () => {};
    const offline = ["1", "true"].includes((process.env.NEXT_PUBLIC_WAYFINDER_OFFLINE ?? "").trim().toLowerCase());
    const sync = startLiveSync({
      caseId,
      // Live cases never show invented progress; only the offline demo may play a labelled preview.
      ...(offline
        ? {
            previewAfterMs: PREVIEW_AFTER_MS,
            onPreview: () => {
              dispatch({ type: "preview" });
              stopMock = playMockStream(
                (event) => dispatch({ type: "event", event }),
                () => dispatch({ type: "previewEnd" }),
              );
            },
          }
        : {}),
      onSnapshot: (data) => dispatch({ type: "runs", data, clientNow: Date.now() }),
      onConnection: (connection) => dispatch({ type: "connection", connection }),
      onDone: (caseStatus) => {
        dispatch({ type: "status", caseStatus: caseStatus ?? "ready" });
        if (caseStatus === "research_failed") return;
        void fetch(`/api/cases/${caseId}/shortlist`)
          .then((response) => (response.ok ? response.json() : null))
          .then((json: unknown) => dispatch({ type: "sources", sources: sourcesFromShortlist(json) }))
          .catch(() => undefined);
      },
    });
    return () => {
      sync.stop();
      stopMock();
    };
  }, [caseId, attempt]);

  const retry = useCallback(async () => {
    setRetrying(true);
    setRetryError(undefined);
    try {
      const response = await fetch(`/api/cases/${caseId}/research`, { method: "POST" });
      // 409 means a run is already going (another tab or a double click): just attach to it.
      if (!response.ok && response.status !== 409) {
        setRetryError(
          response.status === 429
            ? "Too many restarts in a short time. Please wait a little and try again."
            : "Could not restart the search. Please try again in a moment.",
        );
        return;
      }
      dispatch({ type: "reset" });
      setAttempt((n) => n + 1);
    } catch {
      setRetryError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRetrying(false);
    }
  }, [caseId]);

  return { ...state, retry, retrying, retryError };
}
