"use client";

import { useId } from "react";
import { Loader2, Mic, MicOff, PhoneOff, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHONE_LINE_UNAVAILABLE } from "@/lib/channels/vapi-limits";
import { endBrowserCall, startBrowserCall, toggleBrowserCallMute, useBrowserCall } from "./browser-call-store";

export interface BrowserCallButtonProps {
  contactId: string;
  /** Shown above the button: e.g. the phone line hit Vapi's daily limit. */
  reason?: string | null;
  /** The phone send failed: use the "Phone line unavailable" wording. */
  phoneFailed?: boolean;
  onStarted?: () => void;
  /** Row use (live console): a small secondary button while idle; the full widget only once a call is under way. */
  compact?: boolean;
}

/** Shown under the button (full widget) or as its description (compact). Truthful: the call never dials a number. */
export const BROWSER_CALL_HINT = "Approves this call and connects it to your mic. No real number is dialed in safe mode.";

/**
 * DEMO ONLY. The presenter plays the clinic coordinator and talks to the same call agent through the laptop mic.
 * The server approves the drafted call through the normal gate and creates the Vapi web call; this component only
 * joins the room. The call lives in browser-call-store, so a console re-render never drops it. Transcript turns
 * reach the console through the normal Vapi webhook.
 */
export function BrowserCallButton({ contactId, reason, phoneFailed, onStarted, compact = false }: BrowserCallButtonProps) {
  const { phase, error, stage, muted, lines } = useBrowserCall(contactId);
  const hintId = useId();
  const busy = phase === "starting" || phase === "connecting";
  const inCall = phase === "connecting" || phase === "live";

  if (compact && !inCall && lines.length === 0) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-small" data-browser-call={phase} data-stage={stage}>
        <Button
          size="sm"
          variant="secondary"
          aria-describedby={hintId}
          title={BROWSER_CALL_HINT}
          onClick={() => void startBrowserCall(contactId, onStarted)}
          disabled={busy || phase === "ended"}
        >
          {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PhoneOutgoing className="size-4" aria-hidden />}
          {phase === "ended" ? "Browser call ended" : "Take the call in your browser"}
        </Button>
        <span id={hintId} className="sr-only">{BROWSER_CALL_HINT}</span>
        {phoneFailed ? <span className="text-ink-2">{PHONE_LINE_UNAVAILABLE}</span> : null}
        {reason ? <span className="text-ink-2">{reason}</span> : null}
        {error ? <p role="alert" className="m-0 basis-full text-[var(--color-terracotta,#a4532f)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-1 rounded-md border border-dashed border-line-strong bg-paper-2 p-2 text-small" data-browser-call={phase} data-stage={stage}>
      {phoneFailed ? <p className="m-0 font-semibold text-ink">{PHONE_LINE_UNAVAILABLE}</p> : null}
      {reason ? <p className="m-0 text-ink-2">{reason}</p> : null}
      {inCall ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span role="status" className="mr-auto inline-flex items-center gap-1 font-semibold text-ch-call">
            {phase === "live" ? <span aria-hidden className="live-pulse size-2 rounded-pill bg-current" /> : <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {phase === "live" ? "On the call — you are the clinic coordinator" : "Connecting your microphone…"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => toggleBrowserCallMute(contactId)} aria-pressed={muted}>
            {muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void endBrowserCall(contactId)}>
            <PhoneOff className="size-4" aria-hidden /> End call
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => void startBrowserCall(contactId, onStarted)} disabled={busy || phase === "ended"}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PhoneOutgoing className="size-4" aria-hidden />}
            {phase === "ended" ? "Browser call ended" : "Take the call in your browser"}
          </Button>
          {phase === "idle" ? <span className="text-ink-2">{BROWSER_CALL_HINT}</span> : null}
        </div>
      )}
      {lines.length > 0 ? (
        <ol className="m-0 grid list-none gap-0.5 p-0" aria-label="Latest browser call lines">
          {lines.map((l, i) => (
            <li key={`${i}-${l.text.slice(0, 16)}`} className="break-words"><span className="font-semibold text-ink-2">{l.role}: </span>{l.text}</li>
          ))}
        </ol>
      ) : null}
      {error ? <p role="alert" className="m-0 text-[var(--color-terracotta,#a4532f)]">{error}</p> : null}
    </div>
  );
}
