"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";
import {
  disabledReason, EMAIL_DEST_HINT, EMAIL_DEST_LABEL, EMAIL_DEST_OPTIONS, nextChoice,
  type UiAvailability, type UiChoice,
} from "@/lib/demo-live/email-destination-ui";

interface Props {
  caseId: string;
  /** The case's stored choice (the server defaults to the scripted inbox). Never an address. */
  initial: UiChoice;
  available: UiAvailability;
}

/**
 * Per-case switch for where TEST emails go. The only thing sent is one of two words; the server maps it to inboxes it
 * already has configured. Disabled options say why. The outbound gate is unchanged either way.
 */
export function EmailDestinationSwitch({ caseId, initial, available }: Props) {
  const [value, setValue] = useState<UiChoice>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Partial<Record<UiChoice, HTMLButtonElement | null>>>({});

  async function choose(next: UiChoice) {
    if (next === value || pending || !available[next]) return;
    const prev = value;
    setValue(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/demo-live`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "email_destination", value: next }),
      });
      if (!res.ok) throw new Error("rejected");
    } catch {
      setValue(prev);
      setError("Could not change where test emails go.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextChoice(value, e.key, available);
    if (!next) return;
    e.preventDefault();
    void choose(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span id="demo-email-dest-label" className="text-xs font-medium text-ink-2">{EMAIL_DEST_LABEL}</span>
      <div
        role="radiogroup"
        aria-labelledby="demo-email-dest-label"
        aria-describedby="demo-email-dest-hint"
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-line bg-paper-2 p-0.5"
      >
        {EMAIL_DEST_OPTIONS.map((o) => {
          const active = o.value === value;
          const enabled = available[o.value];
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[o.value] = el; }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={!enabled || undefined}
              tabIndex={active ? 0 : -1}
              title={enabled ? undefined : disabledReason(o.value)}
              onClick={() => void choose(o.value)}
              className={cn(
                "inline-flex min-h-8 items-center rounded px-2.5 text-xs font-semibold focus-ring",
                "transition-colors duration-150 motion-reduce:transition-none",
                active ? "bg-teal text-on-teal shadow-sm" : "text-ink-2 hover:bg-card hover:text-ink",
                !enabled && "cursor-not-allowed opacity-55 hover:bg-transparent hover:text-ink-2",
              )}
            >
              {o.label}
              {!enabled ? <span className="sr-only">. Unavailable: {disabledReason(o.value)}.</span> : null}
            </button>
          );
        })}
      </div>
      <span id="demo-email-dest-hint" className="text-xs text-ink-2">
        {EMAIL_DEST_HINT}
        {!available.scripted ? ` ${disabledReason("scripted")}.` : ""}
        {!available.personal ? ` ${disabledReason("personal")}.` : ""}
      </span>
      {error ? <span role="alert" className="text-xs text-terracotta">{error}</span> : null}
    </div>
  );
}
