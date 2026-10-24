"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { AgentName } from "@/lib/contracts";
import { playMockStream } from "./preview";
import {
  applySwarmEvent,
  initialAgents,
  parseRunsSnapshot,
  sourcesFromShortlist,
  type AgentCardState,
  type SourceWithAgent,
  type SwarmEvent,
} from "./stream";

export type Connection = "connecting" | "live" | "reconnecting" | "preview" | "lost";

export type SwarmState = {
  cards: AgentCardState[];
  caseStatus?: string;
  connection: Connection;
  lastActive?: AgentName;
  /** Newest first. */
  sources: SourceWithAgent[];
  previewDone: boolean;
};

type Action =
  | { type: "runs"; data: string }
  | { type: "event"; event: SwarmEvent }
  | { type: "status"; caseStatus: string }
  | { type: "connection"; connection: Connection }
  | { type: "preview" }
  | { type: "previewEnd" }
  | { type: "sources"; sources: SourceWithAgent[] }
  | { type: "reset" };

const INITIAL: SwarmState = {
  cards: initialAgents(),
  connection: "connecting",
  sources: [],
  previewDone: false,
};

function sameCard(a: AgentCardState | undefined, b: AgentCardState): boolean {
  return (
    !!a &&
    a.status === b.status &&
    a.error === b.error &&
    a.outputSummary === b.outputSummary &&
    JSON.stringify(a.counts) === JSON.stringify(b.counts)
  );
}

function changedAgent(prev: AgentCardState[], next: AgentCardState[]): AgentName | undefined {
  return next.find((card, i) => !sameCard(prev[i], card))?.agent;
}

function reducer(state: SwarmState, action: Action): SwarmState {
  switch (action.type) {
    case "runs": {
      const snapshot = parseRunsSnapshot(action.data, state.cards);
      if (!snapshot) return state;
      const changed = changedAgent(state.cards, snapshot.cards);
      return {
        ...state,
        cards: changed ? snapshot.cards : state.cards,
        caseStatus: snapshot.caseStatus ?? state.caseStatus,
        connection: "live",
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
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let stopMock = () => {};
    let sawEvent = false;
    let previewing = false;
    let finished = false;
    const stream = new EventSource(`/api/cases/${caseId}/stream`);

    const offline = ["1", "true"].includes((process.env.NEXT_PUBLIC_WAYFINDER_OFFLINE ?? "").trim().toLowerCase());
    const startPreview = () => {
      if (previewing || sawEvent) return;
      if (!offline) {
        // Live case: never show invented progress. Report the lost connection instead.
        stream.close();
        dispatch({ type: "connection", connection: "lost" });
        return;
      }
      previewing = true;
      stream.close();
      dispatch({ type: "preview" });
      stopMock = playMockStream(
        (event) => dispatch({ type: "event", event }),
        () => dispatch({ type: "previewEnd" }),
      );
    };

    stream.addEventListener("runs", (message) => {
      sawEvent = true;
      dispatch({ type: "runs", data: (message as MessageEvent<string>).data });
    });

    stream.addEventListener("done", (message) => {
      sawEvent = true;
      finished = true;
      stream.close();
      try {
        const body = JSON.parse((message as MessageEvent<string>).data) as { caseStatus?: string };
        if (body.caseStatus) dispatch({ type: "status", caseStatus: body.caseStatus });
      } catch {
        dispatch({ type: "status", caseStatus: "ready" });
      }
      void fetch(`/api/cases/${caseId}/shortlist`)
        .then((response) => (response.ok ? response.json() : null))
        .then((json: unknown) => dispatch({ type: "sources", sources: sourcesFromShortlist(json) }))
        .catch(() => undefined);
    });

    stream.addEventListener("error", (event) => {
      if (finished) return;
      const serverMessage = event instanceof MessageEvent && typeof event.data === "string" && event.data;
      if (serverMessage) {
        stream.close();
        dispatch({ type: "connection", connection: "lost" });
        return;
      }
      if (!sawEvent) startPreview();
      else dispatch({ type: "connection", connection: stream.readyState === EventSource.CLOSED ? "lost" : "reconnecting" });
    });

    const giveUp = offline ? window.setTimeout(startPreview, PREVIEW_AFTER_MS) : undefined;

    return () => {
      if (giveUp !== undefined) window.clearTimeout(giveUp);
      stream.close();
      stopMock();
    };
  }, [caseId, attempt]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch(`/api/cases/${caseId}/research`, { method: "POST" });
    } catch {
      // The stream reports the outcome; a failed POST just leaves the failed state in place.
    }
    dispatch({ type: "reset" });
    setAttempt((n) => n + 1);
    setRetrying(false);
  }, [caseId]);

  return { ...state, retry, retrying };
}
