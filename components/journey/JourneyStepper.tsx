import Link from "next/link";
import type { JourneyPlan } from "./model";
import "./journey.css";

export function JourneyStepper({ plan }: { plan: JourneyPlan }) {
  return (
    <nav className="journey-stepper" aria-label="Case journey">
      <ol>
        {plan.steps.map((step, index) => (
          <li key={step.id}>
            <a href={step.href} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
              <span className="step-index">{index + 1}</span>
              {step.label}
            </a>
          </li>
        ))}
      </ol>
      <p className="journey-extra">
        <Link href={plan.documentsHref}>Documents the outreach agents can use</Link>
      </p>
      {plan.notes.length > 0 ? (
        <ul className="journey-notes">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
