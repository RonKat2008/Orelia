import { cn } from "@/lib/ui/cn";
import { PATIENT_STEPS, type PatientStep } from "@/lib/patient-status/types";
import { PATIENT_HOME_COPY } from "./copy";
import { stepText } from "./home-logic";

/**
 * The 4-segment progress line with "Step 3 of 4 · You choose" (docs/DESIGN-v2.md 5.2). Kept here until the shell's
 * PatientProgress lands. Colour change only, no motion.
 */
export function PatientSteps({ current }: { current: PatientStep }) {
  const index = PATIENT_STEPS.findIndex((step) => step.id === current);
  return (
    <div data-testid="patient-steps" className="grid gap-2">
      <p className="m-0 text-small font-semibold text-ink-2">{stepText(current)}</p>
      <ol aria-label={PATIENT_HOME_COPY.steps.label} className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
        {PATIENT_STEPS.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "upcoming";
          return (
            <li key={step.id} aria-current={state === "current" ? "step" : undefined} data-state={state} className="min-w-0">
              <span aria-hidden className={cn("block h-1.5 rounded-pill", state === "upcoming" ? "bg-line" : "bg-teal")} />
              <span className="sr-only">
                {step.label}
                {state === "done" ? " (done)" : state === "current" ? " (now)" : " (later)"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
