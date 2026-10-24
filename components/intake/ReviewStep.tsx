"use client";

import { ArrowLeft, Compass } from "lucide-react";
import type { Case, CaseInput } from "@/lib/contracts";
import { goalSchema } from "@/lib/contracts";
import { Button, Checkbox, ChoiceRow, Field, Input, Textarea } from "@/components/ui";
import { GOAL_HINTS, GOAL_LABELS } from "./goals";
import { PrivacyNotes } from "./PrivacyNotes";

type Props = {
  draft: Case;
  /** True when the extraction service was offline and fields came from a known sample or are blank. */
  preview: boolean;
  busy: boolean;
  error: string | null;
  onChange: <K extends keyof CaseInput>(key: K, value: CaseInput[K]) => void;
  onToggleGoal: (goal: CaseInput["goals"][number]) => void;
  onBack: () => void;
  onConfirm: () => void;
};

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 grid gap-5 border-0 border-t border-line p-0 pt-6 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full p-0">
        <span className="block font-display text-h3 font-normal text-ink display-soft">{title}</span>
        {note ? <span className="mt-1 block text-small text-ink-2">{note}</span> : null}
      </legend>
      <div className="grid gap-5 items-start sm:grid-cols-2 [&>*:first-child]:clear-both">{children}</div>
    </fieldset>
  );
}

export function ReviewStep({ draft, preview, busy, error, onChange, onToggleGoal, onBack, onConfirm }: Props) {
  const nameMissing = !draft.diseaseName.trim();
  const optionalText = (key: "subtype" | "homeCity" | "homeState" | "insurer" | "planId" | "stageSummary") => ({
    value: draft[key] ?? "",
    onChange: (event: { target: { value: string } }) => onChange(key, event.target.value || undefined),
  });

  return (
    <section aria-labelledby="review-heading" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="grid gap-8">
        <div className="grid gap-2">
          <h2 id="review-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
            Does this look <em className="emph">right</em>?
          </h2>
          <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
            Edit anything that does not match the report. We search with exactly what you confirm here.
          </p>
        </div>

        {preview ? (
          <p role="status" className="m-0 rounded-md border border-gold bg-gold-soft px-4 py-3 text-small text-ink">
            The reading service is not connected, so sample reports are filled from their saved details. Any other
            report needs the fields typed in.
          </p>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameMissing) onConfirm();
          }}
          noValidate
          className="grid gap-8 rounded-lg border border-line bg-card p-5 shadow-md sm:p-8"
        >
          <Section title="The condition" note="As written in the report. We copy it; we do not interpret it.">
            <Field
              label="Diagnosis"
              htmlFor="diseaseName"
              hint="The name of the condition."
              error={nameMissing ? "Add a diagnosis so we know what to search for." : undefined}
              className="sm:col-span-2"
            >
              <Input
                id="diseaseName"
                required
                autoComplete="off"
                value={draft.diseaseName}
                onChange={(event) => onChange("diseaseName", event.target.value)}
                aria-invalid={nameMissing || undefined}
                aria-describedby="diseaseName-hint diseaseName-error"
              />
            </Field>
            <Field label="Subtype" htmlFor="subtype" optional hint="Only if the report names one.">
              <Input id="subtype" autoComplete="off" aria-describedby="subtype-hint" {...optionalText("subtype")} />
            </Field>
            <Field label="Stage summary" htmlFor="stageSummary" optional hint="In the report's own words.">
              <Textarea
                id="stageSummary"
                rows={3}
                className="min-h-24"
                aria-describedby="stageSummary-hint"
                {...optionalText("stageSummary")}
              />
            </Field>
          </Section>

          <Section title="Where you are" note="Used to measure distance and check coverage.">
            <Field label="Home city" htmlFor="homeCity" optional hint="Where you would travel from.">
              <Input id="homeCity" autoComplete="address-level2" aria-describedby="homeCity-hint" {...optionalText("homeCity")} />
            </Field>
            <Field label="Home state" htmlFor="homeState" optional hint="Two-letter code or full name.">
              <Input id="homeState" autoComplete="address-level1" aria-describedby="homeState-hint" {...optionalText("homeState")} />
            </Field>
            <Field label="Insurer" htmlFor="insurer" optional hint="The company on your card.">
              <Input id="insurer" autoComplete="off" aria-describedby="insurer-hint" {...optionalText("insurer")} />
            </Field>
            <Field label="Plan" htmlFor="planId" optional hint="Plan name or ID, if you have it.">
              <Input id="planId" autoComplete="off" aria-describedby="planId-hint" {...optionalText("planId")} />
            </Field>
            <Field label="Travel limit" htmlFor="travelLimitMiles" optional hint="The farthest you would go, in miles.">
              <Input
                id="travelLimitMiles"
                type="number"
                inputMode="numeric"
                min={0}
                aria-describedby="travelLimitMiles-hint"
                value={draft.travelLimitMiles ?? ""}
                onChange={(event) =>
                  onChange("travelLimitMiles", event.target.value === "" ? undefined : Math.max(0, Math.round(Number(event.target.value))))
                }
              />
            </Field>
          </Section>

          <fieldset className="m-0 grid gap-4 border-0 border-t border-line p-0 pt-6">
            <legend className="float-left mb-1 w-full p-0">
              <span className="block font-display text-h3 font-normal text-ink display-soft">What you want help finding</span>
              <span className="mt-1 block text-small text-ink-2">Choose any that apply. You can change this later.</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 [&>*:first-child]:clear-both">
              {goalSchema.options.map((goal) => (
                <ChoiceRow key={goal} title={GOAL_LABELS[goal]} description={GOAL_HINTS[goal]}>
                  <Checkbox
                    checked={draft.goals.includes(goal)}
                    onCheckedChange={() => onToggleGoal(goal)}
                    aria-label={GOAL_LABELS[goal]}
                  />
                </ChoiceRow>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-body text-ink">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
              <ArrowLeft aria-hidden />
              Back to the report
            </Button>
            <Button type="submit" size="lg" loading={busy} loadingText="Starting the search" disabled={nameMissing}>
              <Compass aria-hidden />
              Start the search
            </Button>
          </div>
        </form>
      </div>

      <PrivacyNotes className="lg:sticky lg:top-28 lg:self-start" />
    </section>
  );
}
