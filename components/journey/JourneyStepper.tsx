"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/feedback";
import { Stepper, type StepperStep } from "@/components/ui/display";
import { useMediaQuery, DESKTOP_QUERY } from "@/components/ui/use-media-query";
import { STAGE_HINTS, type JourneyPlan } from "./model";

function toSteps(plan: JourneyPlan): StepperStep[] {
  return plan.steps.map((step) => ({ id: step.id, label: step.label, description: STAGE_HINTS[step.id] }));
}

function currentIndex(plan: JourneyPlan): number {
  return Math.max(
    0,
    plan.steps.findIndex((step) => step.state === "current"),
  );
}

/** The patient journey rail: where you are, and the one thing that needs you next. */
export function JourneyStepper({ plan }: { plan: JourneyPlan }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const index = currentIndex(plan);
  const steps = toSteps(plan);
  const hrefById = new Map(plan.steps.map((step) => [step.id, step.href]));

  const stepper = (
    <Stepper
      orientation="vertical"
      aria-label="Case journey"
      steps={steps}
      current={index}
      renderLabel={(step) => (
        <Link
          href={hrefById.get(step.id as JourneyPlan["current"]) ?? "#"}
          className="rounded-sm text-inherit no-underline hover:underline decoration-teal/50 underline-offset-4 focus-ring"
        >
          {step.label}
        </Link>
      )}
    />
  );

  return (
    <nav aria-label="Case journey" className="grid gap-5">
      <Progress
        label={`Step ${index + 1} of ${plan.steps.length}`}
        valueText={steps[index]?.label}
        value={index + 1}
        max={plan.steps.length}
      />
      {desktop ? (
        stepper
      ) : (
        <Accordion type="single" collapsible>
          <AccordionItem value="journey">
            <AccordionTrigger>All steps</AccordionTrigger>
            <AccordionContent>{stepper}</AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      <Link
        href={plan.documentsHref}
        className="inline-flex min-h-11 items-center gap-2 rounded-sm text-small font-semibold text-teal no-underline hover:underline underline-offset-4 focus-ring"
      >
        <FileText aria-hidden className="size-4" />
        Documents agents can use
      </Link>
      {plan.notes.length > 0 ? (
        <ul className="m-0 grid list-none gap-1.5 p-0 text-small text-ink-2">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
