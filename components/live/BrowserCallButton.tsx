"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHONE_LINE_UNAVAILABLE } from "@/lib/channels/vapi-limits";

type Phase = "idle" | "starting" | "connecting" | "live" | "ended" | "error";

interface VapiLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  reconnect(webCall: { webCallUrl: string; id?: string }): Promise<void>;
  stop(): Promise<void>;
  setMuted(mute: boolean): void;
}

export interface BrowserCallButtonProps {
  contactId: string;
  /** Shown above the button: e.g. the phone line hit Vapi's daily limit. */
  reason?: string | null;
  /** The phone send failed: use the "Phone line unavailable" wording. */
  phoneFailed?: boolean;
  onStarted?: () => void;
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

/**
 * DEMO ONLY. The presenter plays the clinic coordinator and talks to the same call agent through the laptop mic.
 * The server approves the drafted call through the normal gate and creates the Vapi web call; this component only
 * gets the room URL and joins it. Transcript turns arrive in the console through the normal webhook.
 */
export function BrowserCallButton({ contactId, reason, phoneFailed, onStarted }: BrowserCallButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<{ role: string; text: string }[]>([]);
  const vapiRef = useRef<VapiLike | null>(null);

  useEffect(() => () => { void vapiRef.current?.stop().catch(() => undefined); }, []);

  async function start() {
    setPhase("starting");
    setError(null);
    try {
      const d = await fetch(`/api/contacts/${contactId}/drafts`, { method: "POST", headers: json, body: "{}", credentials: "same-origin" });
      if (!d.ok) throw new Error(await reasonsOf(d));
      const draft = (await d.json()) as { id: string };
      const res = await fetch(`/api/contacts/${contactId}/browser-call?view=judge`, { method: "POST", headers: json, body: JSON.stringify({ draftId: draft.id }), credentials: "same-origin" });
      if (!res.ok) throw new Error(await reasonsOf(res));
      const call = (await res.json()) as { callId: string; webCallUrl: string; publicKey: string };
      onStarted?.();
      setPhase("connecting");
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(call.publicKey) as unknown as VapiLike;
      vapiRef.current = vapi;
      vapi.on("call-start", () => setPhase("live"));
      vapi.on("call-end", () => setPhase("ended"));
      vapi.on("error", () => setError("The browser call hit an error. Check the microphone permission and try again."));
      vapi.on("message", (m: unknown) => {
        const msg = m as { type?: string; transcriptType?: string; role?: string; transcript?: string };
        if (msg?.type === "transcript" && msg.transcriptType === "final" && typeof msg.transcript === "string") {
          setLines((prev) => [...prev, { role: msg.role === "assistant" ? "AI" : "You", text: msg.transcript as string }].slice(-4));
        }
      });
      await vapi.reconnect({ webCallUrl: call.webCallUrl, id: call.callId });
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Could not start the browser call.");
    }
  }

  async function end() {
    await vapiRef.current?.stop().catch(() => undefined);
    setPhase("ended");
  }

  function toggleMute() {
    const next = !muted;
    vapiRef.current?.setMuted(next);
    setMuted(next);
  }

  const busy = phase === "starting" || phase === "connecting";
  const inCall = phase === "connecting" || phase === "live";

  return (
    <div className="grid gap-1 rounded-md border border-dashed border-line-strong bg-paper-2 p-2 text-small" data-browser-call={phase}>
      {phoneFailed ? <p className="m-0 font-semibold text-ink">{PHONE_LINE_UNAVAILABLE}</p> : null}
      {reason ? <p className="m-0 text-ink-2">{reason}</p> : null}
      {inCall ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span role="status" className="mr-auto inline-flex items-center gap-1 font-semibold text-ch-call">
            {phase === "live" ? <span aria-hidden className="live-pulse size-2 rounded-pill bg-current" /> : <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {phase === "live" ? "On the call — you are the clinic coordinator" : "Connecting your microphone…"}
          </span>
          <Button size="sm" variant="secondary" onClick={toggleMute} aria-pressed={muted}>
            {muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void end()}>
            <PhoneOff className="size-4" aria-hidden /> End call
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => void start()} disabled={busy || phase === "ended"}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PhoneOutgoing className="size-4" aria-hidden />}
            {phase === "ended" ? "Browser call ended" : "Take the call in your browser"}
          </Button>
          {phase === "idle" ? <span className="text-ink-2">Approves this call and connects it to your mic. Demo only; no number is dialed.</span> : null}
        </div>
      )}
      {lines.length > 0 ? (
        <ol className="m-0 grid list-none gap-0.5 p-0" aria-label="Latest browser call lines">
          {lines.map((l, i) => (
            <li key={i} className="break-words"><span className="font-semibold text-ink-2">{l.role}: </span>{l.text}</li>
          ))}
        </ol>
      ) : null}
      {error ? <p role="alert" className="m-0 text-[var(--color-terracotta,#a4532f)]">{error}</p> : null}
    </div>
  );
}
