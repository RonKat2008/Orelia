import { cn } from "@/lib/ui/cn";
import { PATIENT_STEPS, type PatientStep } from "@/lib/patient-status/types";
import type { JourneyStage } from "@/components/journey/model";

/** The judge's 7 stages folded into the patient's 4 steps (docs/DESIGN-v2.md 5.2). */
export const PATIENT_STEP_FOR_STAGE: Record<JourneyStage, PatientStep> = {
  intake: "tell",
  research: "search",
  shortlist: "choose",
  consent: "choose",
  plan: "choose",
  outreach: "reach",
  tracker: "reach",
};

export interface PatientProgressProps {
  current: PatientStep;
  /** Hide the "Step 3 of 4 · You choose" line (when the page already says where you are). */
  hideLabel?: boolean;
  className?: string;
}

/**
 * PatientProgress: the only stepper in patient view. One line ("Step 3 of 4 · You choose") over four segments.
 * Done steps go quiet; the current one is teal. The segments are decorative; the words carry the state.
 */
export function PatientProgress({ current, hideLabel = false, className }: PatientProgressProps) {
  const index = Math.max(0, PATIENT_STEPS.findIndex((step) => step.id === current));
  const step = PATIENT_STEPS[index];
  return (
    <div data-slot="patient-progress" className={cn("grid gap-2", className)}>
      <p className={cn("m-0 text-small text-ink-2", hideLabel && "sr-only")}>
        <span className="font-semibold text-ink">
          Step {index + 1} of {PATIENT_STEPS.length}
        </span>
        {" · "}
        {step?.label}
      </p>
      <ol aria-hidden className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
        {PATIENT_STEPS.map((item, i) => (
          <li key={item.id} className="relative h-1.5 overflow-hidden rounded-pill bg-line">
            <span
              className={cn(
                "absolute inset-0 origin-left rounded-pill bg-teal transition-transform duration-400 ease-out-expo motion-reduce:transition-none",
                i <= index ? "scale-x-100" : "scale-x-0",
                i < index && "opacity-60",
              )}
            />
          </li>
        ))}
      </ol>
      <ol className="sr-only">
        {PATIENT_STEPS.map((item, i) => (
          <li key={item.id} aria-current={i === index ? "step" : undefined}>
            {item.label}
            {i < index ? " (done)" : i === index ? " (now)" : " (later)"}
          </li>
        ))}
      </ol>
    </div>
  );
}

