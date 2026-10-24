"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Case, CaseInput } from "@/lib/contracts";
import { goalSchema, TRAVEL_LIMIT_MAX_MILES } from "@/lib/contracts";
import {
  Button,
  Checkbox,
  ChoiceRow,
  Details,
  ErrorSummary,
  Input,
  SummaryList,
  Textarea,
} from "@/components/ui";
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

type OptionalTextKey =
  "subtype" | "homeCity" | "homeState" | "insurer" | "planId" | "stageSummary";
type RowKey = "diseaseName" | OptionalTextKey | "travelLimitMiles" | "goals";

const NAME_ERROR = "Add a diagnosis so we know what to search for";
const NAME_FIELD_ID = "edit-diseaseName";

function toMiles(raw: string): number | undefined {
  const miles = Number(raw);
  return raw === "" || !Number.isFinite(miles)
    ? undefined
    : Math.min(TRAVEL_LIMIT_MAX_MILES, Math.max(0, Math.round(miles)));
}

export function ReviewStep({
  draft,
  preview,
  busy,
  error,
  onChange,
  onToggleGoal,
  onBack,
  onConfirm,
}: Props) {
  const nameMissing = !draft.diseaseName.trim();
  const [editing, setEditing] = useState<ReadonlySet<RowKey>>(
    () => new Set(nameMissing ? ["diseaseName"] : []),
  );
  const [justOpened, setJustOpened] = useState<RowKey | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && nameMissing;

  // Move focus into a row's field right after its Change link opens it.
  useEffect(() => {
    if (justOpened) document.getElementById(`edit-${justOpened}`)?.focus();
  }, [justOpened]);

  function toggle(key: RowKey) {
    const next = new Set(editing);
    if (next.has(key)) {
      next.delete(key);
      setJustOpened(null);
    } else {
      next.add(key);
      setJustOpened(key);
    }
    setEditing(next);
  }

  function text(
    key: OptionalTextKey,
    label: string,
    multiline = false,
  ): ReactNode {
    const props = {
      id: `edit-${key}`,
      "aria-label": label,
      value: draft[key] ?? "",
      onChange: (event: { target: { value: string } }) =>
        onChange(key, event.target.value || undefined),
    };
    return multiline ? (
      <Textarea rows={3} className="min-h-24" {...props} />
    ) : (
      <Input autoComplete="off" {...props} />
    );
  }

  function row(
    key: RowKey,
    label: string,
    shown: string | undefined,
    editor: ReactNode,
  ) {
    const open = editing.has(key);
    return {
      label,
      value: open ? editor : shown,
      onChange: () => toggle(key),
      changeLabel: label.toLowerCase(),
    };
  }

  const goalsShown = draft.goals.map((goal) => GOAL_LABELS[goal]).join(", ");
  const rows = [
    row(
      "diseaseName",
      "Diagnosis",
      draft.diseaseName.trim(),
      <div className="grid gap-2">
        <Input
          id={NAME_FIELD_ID}
          aria-label="Diagnosis"
          autoComplete="off"
          required
          value={draft.diseaseName}
          onChange={(event) => onChange("diseaseName", event.target.value)}
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "diseaseName-error" : undefined}
        />
        {nameError ? (
          <p
            id="diseaseName-error"
            className="m-0 text-body font-semibold text-danger"
          >
            <span className="sr-only">Error: </span>
            {NAME_ERROR}
          </p>
        ) : null}
      </div>,
    ),
    row("subtype", "Subtype", draft.subtype, text("subtype", "Subtype")),
    row(
      "stageSummary",
      "Stage summary",
      draft.stageSummary,
      text("stageSummary", "Stage summary", true),
    ),
    row("homeCity", "Home city", draft.homeCity, text("homeCity", "Home city")),
    row(
      "homeState",
      "Home state",
      draft.homeState,
      text("homeState", "Home state"),
    ),
    row("insurer", "Insurer", draft.insurer, text("insurer", "Insurer")),
    row("planId", "Plan", draft.planId, text("planId", "Plan")),
    row(
      "travelLimitMiles",
      "Travel limit",
      draft.travelLimitMiles === undefined
        ? undefined
        : `${draft.travelLimitMiles} miles`,
      <Input
        id="edit-travelLimitMiles"
        aria-label="Travel limit in miles"
        type="number"
        inputMode="numeric"
        min={0}
        max={TRAVEL_LIMIT_MAX_MILES}
        value={draft.travelLimitMiles ?? ""}
        onChange={(event) =>
          onChange("travelLimitMiles", toMiles(event.target.value))
        }
      />,
    ),
    row(
      "goals",
      "What you want help finding",
      goalsShown,
      <div id="edit-goals" tabIndex={-1} className="grid gap-3 sm:grid-cols-2">
        {goalSchema.options.map((goal) => (
          <ChoiceRow
            key={goal}
            title={GOAL_LABELS[goal]}
            description={GOAL_HINTS[goal]}
          >
            <Checkbox
              checked={draft.goals.includes(goal)}
              onCheckedChange={() => onToggleGoal(goal)}
              aria-label={GOAL_LABELS[goal]}
            />
          </ChoiceRow>
        ))}
      </div>,
    ),
  ];

  return (
    <section aria-labelledby="review-heading" className="grid max-w-3xl gap-8">
      <div className="grid gap-2">
        <h1
          id="review-heading"
          tabIndex={-1}
          className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance outline-none"
        >
          Check the details
        </h1>
        <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
          Use Change on anything that does not match the report. We search with
          exactly what you confirm here.
        </p>
      </div>

      {preview ? (
        <p
          role="status"
          className="m-0 rounded-md border border-gold bg-gold-soft px-4 py-3 text-small text-ink"
        >
          The reading service is not connected, so sample reports are filled
          from their saved details. Any other report needs the fields typed in.
        </p>
      ) : null}

      {submitted && nameMissing ? (
        <ErrorSummary
          errors={[{ fieldId: NAME_FIELD_ID, message: NAME_ERROR }]}
        />
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (nameMissing) {
            setSubmitted(true);
            setEditing((current) => new Set(current).add("diseaseName"));
            return;
          }
          onConfirm();
        }}
        className="grid gap-6"
      >
        <SummaryList rows={rows} />

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-body text-ink"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button
            type="submit"
            size="lg"
            loading={busy}
            loadingText="Starting the search"
          >
            Start the search
          </Button>
          <Button type="button" variant="link" onClick={onBack} disabled={busy}>
            Back to the report
          </Button>
        </div>
      </form>

      <Details summary="how your details are used">
        <PrivacyNotes />
      </Details>
    </section>
  );
}
