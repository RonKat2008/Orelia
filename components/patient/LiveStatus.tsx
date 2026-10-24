"use client";

import { AnimatePresence, motion } from "motion/react";
import { Progress } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { EASE_OUT_EXPO } from "@/lib/ui/motion";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import type { PatientStatus, PatientTone } from "@/lib/patient-status/types";
import type { LiveMode } from "./usePatientStatus";

const TONE: Record<PatientTone, { word: string; dot: string }> = {
  working: { word: "Working on it", dot: "bg-teal" },
  you: { word: "Your turn", dot: "bg-terracotta" },
  waiting: { word: "Waiting to hear back", dot: "bg-gold" },
  good: { word: "Good news", dot: "bg-ok" },
  problem: { word: "Needs a look", dot: "bg-danger" },
};

/** The big plain-language status line. It is the page's h1 and a polite live region, so changes are announced. */
export function LiveStatus({ status, mode }: { status: PatientStatus; mode: LiveMode }) {
  const reduced = useReducedMotionGate();
  const tone = TONE[status.tone];
  const key = `${status.headline}|${status.detail ?? ""}`;
  const content = (
    <>
      <h1
        id="patient-status-heading"
        data-testid="patient-status-headline"
        className="m-0 max-w-[24ch] font-display text-h1 font-light text-ink display-soft text-balance"
      >
        {status.headline}
      </h1>
      {status.detail ? <p className="m-0 mt-4 max-w-prose text-lead text-ink-2 text-pretty">{status.detail}</p> : null}
    </>
  );

  return (
    <section aria-labelledby="patient-status-heading" data-testid="patient-status" data-tone={status.tone} className="grid gap-5">
      <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 text-small font-semibold text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className={cn("size-2.5 rounded-pill", tone.dot)} />
          {tone.word}
        </span>
        <span className="inline-flex items-center gap-2 font-normal text-ink-3" data-live-mode={mode}>
          <span aria-hidden className="relative flex size-2">
            {mode === "live" ? (
              <span className="absolute inline-flex size-full animate-ping rounded-pill bg-teal/60 motion-reduce:animate-none" />
            ) : null}
            <span className={cn("relative inline-flex size-2 rounded-pill", mode === "live" ? "bg-teal" : "bg-line-strong")} />
          </span>
          {mode === "live" ? "Live: updates on its own" : mode === "polling" ? "Checking for updates every few seconds" : "Connecting"}
        </span>
      </p>

      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-[7rem]">
        {reduced ? (
          <div key={key}>{content}</div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT_EXPO } }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.2, ease: EASE_OUT_EXPO } }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {status.progress ? (
        <Progress
          value={status.progress.done}
          max={status.progress.total}
          label="Search progress"
          valueText={`${status.progress.done} of ${status.progress.total} sources done`}
          className="max-w-xl"
        />
      ) : null}
    </section>
  );
}
