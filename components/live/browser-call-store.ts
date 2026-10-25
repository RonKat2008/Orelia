"use client";

import { useSyncExternalStore } from "react";

/**
 * DEMO ONLY: browser-call sessions, one per contact, kept outside React so a re-render or remount of the console
 * (lanes change state the moment the call is approved) never tears down a call in progress.
 */
export type BrowserCallPhase = "idle" | "starting" | "connecting" | "live" | "ended" | "error";

export interface BrowserCallSession {
  phase: BrowserCallPhase;
  error: string | null;
  /** Last SDK start stage, for diagnosing a stuck connection (rendered as a data attribute only). */
  stage: string;
  muted: boolean;
  lines: readonly { role: string; text: string }[];
}

interface VapiLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  reconnect(webCall: { webCallUrl: string; id?: string }): Promise<void>;
  stop(): Promise<void>;
  setMuted(mute: boolean): void;
}

const IDLE: BrowserCallSession = { phase: "idle", error: null, stage: "", muted: false, lines: [] };
const MAX_LINES = 4;
const sessions = new Map<string, BrowserCallSession>();
const calls = new Map<string, VapiLike>();
const listeners = new Set<() => void>();

const get = (contactId: string): BrowserCallSession => sessions.get(contactId) ?? IDLE;
function set(contactId: string, patch: Partial<BrowserCallSession>): void {
  sessions.set(contactId, { ...get(contactId), ...patch });
  for (const l of listeners) l();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBrowserCall(contactId: string): BrowserCallSession {
  return useSyncExternalStore(subscribe, () => get(contactId), () => IDLE);
}

/** True once a browser call was started for this contact on this page (keeps its widget on screen). */
export function useHasBrowserCall(contactId: string): boolean {
  return useBrowserCall(contactId).phase !== "idle";
}

const json = { "content-type": "application/json" };

async function reasonsOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { reasons?: unknown; detail?: unknown };
    const reasons = Array.isArray(body.reasons) ? body.reasons.join(", ") : "";
    return [reasons, typeof body.detail === "string" ? body.detail : ""].filter(Boolean).join(". ") || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function isNormalEnd(e: unknown): boolean {
  let text = "";
  try { text = JSON.stringify(e) ?? ""; } catch { return false; }
  return /meeting has ended|ejected|ejection/i.test(text.slice(0, 2000));
}

function wire(contactId: string, vapi: VapiLike): void {
  vapi.on("call-start", () => set(contactId, { phase: "live" }));
  vapi.on("call-end", () => { calls.delete(contactId); set(contactId, { phase: "ended" }); });
  vapi.on("call-start-progress", (p: unknown) => {
    const e = p as { stage?: string; status?: string };
    set(contactId, { stage: `${e?.stage ?? "?"}:${e?.status ?? "?"}` });
  });
  vapi.on("error", (e: unknown) => {
    // The assistant hanging up ejects the browser from the room ("Meeting has ended"): that is a normal end.
    if (isNormalEnd(e)) { calls.delete(contactId); set(contactId, { phase: "ended" }); return; }
    const kind = (e as { type?: string; stage?: string })?.type ?? (e as { stage?: string })?.stage;
    set(contactId, { error: `The browser call hit an error${kind ? ` (${String(kind).slice(0, 60)})` : ""}. Check the microphone permission and try again.` });
  });
  vapi.on("message", (m: unknown) => {
    const msg = m as { type?: string; transcriptType?: string; role?: string; transcript?: string };
    if (msg?.type !== "transcript" || msg.transcriptType !== "final" || typeof msg.transcript !== "string") return;
    const line = { role: msg.role === "assistant" ? "AI" : "You", text: msg.transcript };
    set(contactId, { lines: [...get(contactId).lines, line].slice(-MAX_LINES) });
  });
}

/**
 * Approves the drafted call and joins it: the server runs the normal gate and creates the Vapi web call; the browser
 * gets only the call id and room URL and joins with @vapi-ai/web.
 */
export async function startBrowserCall(contactId: string, onStarted?: () => void): Promise<void> {
  if (calls.has(contactId) || ["starting", "connecting", "live"].includes(get(contactId).phase)) return;
  set(contactId, { phase: "starting", error: null, stage: "", lines: [] });
  try {
    const d = await fetch(`/api/contacts/${contactId}/drafts`, { method: "POST", headers: json, body: "{}", credentials: "same-origin" });
    if (!d.ok) throw new Error(await reasonsOf(d));
    const draft = (await d.json()) as { id: string };
    const res = await fetch(`/api/contacts/${contactId}/browser-call?view=judge`, { method: "POST", headers: json, body: JSON.stringify({ draftId: draft.id }), credentials: "same-origin" });
    if (!res.ok) throw new Error(await reasonsOf(res));
    const call = (await res.json()) as { callId: string; webCallUrl: string; publicKey: string };
    set(contactId, { phase: "connecting" });
    onStarted?.();
    const { default: Vapi } = await import("@vapi-ai/web");
    // avoidEval: Daily loads its call machine with a script tag (CSP allows c.daily.co on this page only; no unsafe-eval).
    const vapi = new Vapi(call.publicKey, undefined, { avoidEval: true }) as unknown as VapiLike;
    calls.set(contactId, vapi);
    wire(contactId, vapi);
    await vapi.reconnect({ webCallUrl: call.webCallUrl, id: call.callId });
  } catch (e) {
    calls.delete(contactId);
    set(contactId, { phase: "error", error: e instanceof Error ? e.message : "Could not start the browser call." });
  }
}

export async function endBrowserCall(contactId: string): Promise<void> {
  const vapi = calls.get(contactId);
  calls.delete(contactId);
  await vapi?.stop().catch(() => undefined);
  set(contactId, { phase: "ended" });
}

export function toggleBrowserCallMute(contactId: string): void {
  const next = !get(contactId).muted;
  calls.get(contactId)?.setMuted(next);
  set(contactId, { muted: next });
}
