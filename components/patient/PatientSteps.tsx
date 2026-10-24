import { Check } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { PATIENT_STEPS, type PatientStep } from "@/lib/patient-status/types";

/** Four friendly steps with the current one highlighted. */
export function PatientSteps({ current }: { current: PatientStep }) {
  const index = PATIENT_STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Your progress" className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:gap-4">
      {PATIENT_STEPS.map((step, i) => {
        const state = i < index ? "done" : i === index ? "current" : "upcoming";
        return (
          <li key={step.id} aria-current={state === "current" ? "step" : undefined} data-state={state} className="grid min-w-0 gap-2">
            <span
              aria-hidden
              className={cn(
                "h-1.5 rounded-pill transition-colors duration-500 motion-reduce:transition-none",
                state === "upcoming" ? "bg-line" : "bg-teal",
                state === "current" && "shadow-[0_0_0_3px_var(--teal-soft)]",
              )}
            />
            <span
              className={cn(
                "flex min-w-0 items-center gap-1 text-small sm:text-body",
                state === "current" ? "font-semibold text-ink" : state === "done" ? "text-ink-2" : "text-ink-3",
              )}
            >
              {state === "done" ? <Check aria-hidden className="size-4 shrink-0 text-teal" /> : null}
              <span className="min-w-0 break-words">{step.label}</span>
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (now)" : " (later)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
