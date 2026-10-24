"use client";

import { useSyncExternalStore } from "react";
import { Badge, Progress } from "@/components/ui";
import type { PatientStatus } from "@/lib/patient-status/types";
import { PATIENT_HOME_COPY } from "./copy";
import { statusBadgeTone, statusWord } from "./home-logic";
import type { LiveMode } from "./usePatientStatus";
import { relativeTime } from "./WhatsHappened";

const MINUTE = 60_000;
const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, MINUTE);
  return () => clearInterval(id);
};
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/**
 * The status line ("Your turn · Updated 2 min ago") and the page h1 (docs/DESIGN-v2.md 7.4). What it says and when
 * comes from lib/patient-status; this only presents it. Changes are announced through polite live regions; the
 * timestamp sits outside them so the minute tick is never read out.
 */
export function LiveStatus({ status, mode }: { status: PatientStatus; mode: LiveMode }) {
  const now = useSyncExternalStore(subscribe, minuteNow, () => 0);
  const ago = now ? relativeTime(status.updatedAt, now) : null;

  return (
    <section
      aria-labelledby="patient-status-heading"
      data-testid="patient-status"
      data-tone={status.tone}
      data-live-mode={mode}
      className="grid gap-3"
    >
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
        <span role="status" aria-live="polite" aria-atomic="true">
          <Badge tone={statusBadgeTone(status.tone)}>{statusWord(status.tone)}</Badge>
        </span>
        {ago ? <span>{PATIENT_HOME_COPY.updated(ago)}</span> : null}
      </p>

      <div role="status" aria-live="polite" aria-atomic="true" className="grid gap-3">
        <h1
          id="patient-status-heading"
          data-testid="patient-status-headline"
          className="m-0 font-display text-h1 font-light text-ink display-soft text-balance"
        >
          {status.headline}
        </h1>
        {status.detail ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{status.detail}</p> : null}
      </div>

      {status.progress ? (
        <Progress
          value={status.progress.done}
          max={status.progress.total}
          label={PATIENT_HOME_COPY.searchProgress.label}
          valueText={PATIENT_HOME_COPY.searchProgress.valueText(status.progress.done, status.progress.total)}
          className="max-w-xl"
        />
      ) : null}
    </section>
  );
}
