"use client";

import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardEyebrow, CardTitle } from "@/components/ui/card";
import { EmptyState, Stat, StatGroup } from "@/components/ui/display";
import { Skeleton } from "@/components/ui/feedback";
import { useJourney } from "./JourneyShell";
import { GOAL_LABELS, buildActivity, buildNeeds } from "./model";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-micro font-semibold uppercase text-ink-3">{label}</dt>
      <dd className="m-0 text-body text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function CaseHome({ caseId }: { caseId: string }) {
  const { plan, data } = useJourney();

  if (!data) {
    return (
      <div role="status" aria-busy="true" className="grid gap-6">
        <span className="sr-only">Loading your case</span>
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (data.missingCase) {
    return (
      <EmptyState
        icon={<Compass />}
        title="We could not find this case"
        description="It may have been removed, or the link may be incomplete. You can start a new case in a few minutes."
        action={
          <Button asChild>
            <Link href="/start">Start a case</Link>
          </Button>
        }
      />
    );
  }

  const summary = data.summary;
  const needs = buildNeeds(plan, data.tasks, caseId);
  const activity = buildActivity(data.contacts, data.tasks);
  const doneSteps = plan.steps.filter((step) => step.state === "complete").length;
  const openTasks = needs.length - 1;

  return (
    <div className="grid gap-12">
      <header className="grid gap-4">
        <p className="m-0 flex flex-wrap items-center gap-3 text-micro font-semibold uppercase text-ink-3">
          <span>Case {caseId.slice(0, 8)}</span>
          {summary?.status ? <Badge tone="teal">{summary.status.replaceAll("_", " ")}</Badge> : null}
        </p>
        <h1 className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance">
          {summary?.diseaseName ?? "Your case"}
        </h1>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          Everything you confirmed, where research stands and what comes next. Wayfinder coordinates contact; it
          does not interpret your case or suggest care.
        </p>
        {!summary ? (
          <p role="status" className="m-0 text-small text-warn-ink">
            Case details could not be loaded. You can still move through the steps.
          </p>
        ) : null}
      </header>

      <section aria-labelledby="needs-heading">
        <Card variant="raised" padding="lg" className="border-l-4 border-l-teal">
          <CardEyebrow>What needs you now</CardEyebrow>
          <CardTitle id="needs-heading" className="mt-2">
            {needs.length > 1 ? `${openTasks} ${openTasks === 1 ? "item" : "items"} waiting, then your next step` : "Your next step"}
          </CardTitle>
          <ul className="m-0 mt-5 grid list-none gap-3 p-0">
            {needs.map((item, i) => (
              <li key={item.id} className="flex items-start gap-3">
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-pill bg-terracotta" />
                {i === 0 ? (
                  <span className="text-body font-semibold text-ink">{item.text}</span>
                ) : (
                  <Link href={item.href} className="text-body text-ink underline decoration-teal/40 underline-offset-4 hover:text-teal focus-ring rounded-sm">
                    {item.text}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Button asChild size="lg">
              <Link href={plan.nextHref}>
                {plan.nextLabel}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      <section aria-labelledby="progress-heading" className="grid gap-5">
        <h2 id="progress-heading" className="m-0 font-display text-h3 font-normal display-soft">
          Where things stand
        </h2>
        <StatGroup>
          <Stat label="Steps done" value={`${doneSteps} of ${plan.steps.length}`} />
          <Stat label="Contacts chosen" value={count(data.selectedCount)} />
          <Stat label="Waiting on you" value={count(data.openTaskCount)} />
        </StatGroup>
      </section>

      <div className="grid gap-12 xl:grid-cols-2">
        <section aria-labelledby="fields-heading" className="grid content-start gap-5">
          <h2 id="fields-heading" className="m-0 font-display text-h3 font-normal display-soft">
            The case you confirmed
          </h2>
          {summary ? (
            <Card padding="md">
              <dl className="m-0">
                <Field label="Condition">{summary.diseaseName}</Field>
                {summary.subtype ? <Field label="Subtype">{summary.subtype}</Field> : null}
                {summary.stageSummary ? <Field label="Stage, as you wrote it">{summary.stageSummary}</Field> : null}
                {summary.location ? <Field label="Home">{summary.location}</Field> : null}
                {summary.insurer ? <Field label="Insurer">{summary.insurer}</Field> : null}
                <Field label="Goals">
                  {summary.goals.length > 0
                    ? summary.goals.map((goal) => GOAL_LABELS[goal] ?? goal).join(", ")
                    : "None recorded"}
                </Field>
              </dl>
            </Card>
          ) : (
            <p className="m-0 text-body text-ink-2">No confirmed fields yet.</p>
          )}
        </section>

        <section aria-labelledby="activity-heading" className="grid content-start gap-5">
          <h2 id="activity-heading" className="m-0 font-display text-h3 font-normal display-soft">
            Recent activity
          </h2>
          {activity.length > 0 ? (
            <ol className="m-0 grid list-none gap-0 border-l-2 border-line p-0">
              {activity.map((item) => (
                <li key={item.id} className="relative py-2.5 pl-6 text-body text-ink">
                  <span aria-hidden className="absolute -left-[5px] top-[1.1rem] size-2 rounded-pill bg-teal" />
                  {item.text}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="Nothing has happened yet"
              description="Once agents start reading sources and you approve contact, each step is written down here."
            />
          )}
        </section>
      </div>
    </div>
  );
}
