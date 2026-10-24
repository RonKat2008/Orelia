"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  BackLink,
  Button,
  ChoiceRow,
  EmptyState,
  ErrorSummary,
  LoadingState,
  PageHeader,
  Question,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  SummaryList,
  toast,
} from "@/components/ui";
import { BackButton } from "@/components/intake/patient/BackButton";
import { StepTransition } from "@/components/intake/patient/StepTransition";
import { contactLabel, saveContactConsent, type ApiContact } from "@/components/outreach/client";
import type { ShareableFieldKey } from "@/components/outreach/fields";
import type { CaseInput } from "@/lib/contracts";
import { ActionError, ActionFrame } from "../../actions/ActionFrame";
import { useStepFocus } from "../useStepFocus";
import { CONSENT_COPY as COPY } from "./copy";
import {
  audienceLabel,
  consentItems,
  firstScreen,
  flowOrder,
  nextScreen,
  previousScreen,
  sharedFromAnswers,
  summaryRows,
  type ConsentAnswer,
  type ConsentAnswers,
  type ConsentScreen,
} from "./logic";
import { useConsentTargets } from "./useConsentTargets";

export type ConsentLayout = "card" | "page";

export interface ConsentFlowProps {
  caseId: string;
  /** "card": inside the case home's one ActionCard. "page": the consent sub-page, one question per page. */
  layout: ConsentLayout;
  /** Page layout: heading level of each screen's title. */
  titleAs?: "h1" | "h2";
  /** Card layout: the quiet "See details" link. */
  detailsHref?: string;
  /** After the choices are saved for everyone. */
  onSaved: () => Promise<void> | void;
}

const KIND = "share_details";

/**
 * Patient consent (docs/DESIGN-v2.md 7.7): one detail per screen, only details we have, Yes or No, then a
 * check-answers page. Saving uses the same calls as before: one set of choices, saved for every picked person who has
 * no saved consent yet. Existing consent is never overwritten, and only what the patient says yes to is shared.
 */
export function ConsentFlow({ caseId, layout, titleAs = "h1", detailsHref, onSaved }: ConsentFlowProps) {
  const targets = useConsentTargets(caseId);
  const back = <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>;

  if (!targets) {
    const skeleton = (
      <LoadingState label={COPY.loading}>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingState>
    );
    return layout === "card" ? (
      <ActionFrame kind={KIND} title={COPY.pageTitle} detailsHref={detailsHref}>
        {skeleton}
      </ActionFrame>
    ) : (
      <div className="grid max-w-patient gap-6">
        {back}
        <PageHeader as={titleAs} title={COPY.pageTitle} className="mb-0" />
        {skeleton}
      </div>
    );
  }

  if (!targets.record || targets.people.length === 0) {
    const empty = !targets.record
      ? { title: COPY.pageTitle, description: COPY.loadFailed }
      : targets.total === 0
        ? COPY.nobody
        : COPY.done;
    if (layout === "card") {
      return (
        <ActionFrame kind={KIND} title={empty.title} lede={empty.description} detailsHref={detailsHref}>
          {!targets.record ? <ActionError messages={[COPY.loadFailed]} /> : null}
        </ActionFrame>
      );
    }
    return (
      <div className="grid max-w-patient gap-6">
        {back}
        <PageHeader as={titleAs} title={COPY.pageTitle} className="mb-0" />
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={
            <Link href={`/cases/${caseId}`} className="rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring">
              {COPY.backToCase}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <ConsentSteps
      caseId={caseId}
      record={targets.record}
      people={targets.people}
      layout={layout}
      titleAs={titleAs}
      detailsHref={detailsHref}
      onSaved={onSaved}
    />
  );
}

interface StepsProps extends Omit<ConsentFlowProps, "titleAs"> {
  record: CaseInput;
  people: ApiContact[];
  titleAs: "h1" | "h2";
}

function ConsentSteps({ caseId, record, people, layout, titleAs, detailsHref, onSaved }: StepsProps) {
  const [items] = useState(() => consentItems(record));
  const [extras, setExtras] = useState(false);
  const [answers, setAnswers] = useState<ConsentAnswers>({});
  const [screen, setScreen] = useState<ConsentScreen>(() => firstScreen(flowOrder(items, false)));
  const [returnToCheck, setReturnToCheck] = useState(false);
  const [choiceError, setChoiceError] = useState<string | undefined>(undefined);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const focusRef = useStepFocus<HTMLDivElement>(screen);

  const order = flowOrder(items, extras);
  const org = audienceLabel(people.map((person) => contactLabel(person)));

  function go(next: ConsentScreen) {
    setChoiceError(undefined);
    setScreen(next);
  }

  function goBack() {
    const previous = previousScreen(order, screen, returnToCheck, items.known.length);
    setReturnToCheck(false);
    if (previous) go(previous);
  }

  function addMore() {
    const first = items.missing[0];
    if (!first) return;
    setExtras(true);
    setReturnToCheck(false);
    go(first);
  }

  function change(key: ShareableFieldKey) {
    setReturnToCheck(true);
    go(key);
  }

  function answerQuestion(key: ShareableFieldKey) {
    if (!answers[key]) {
      setChoiceError(COPY.choiceError);
      return;
    }
    const next = nextScreen(order, key, returnToCheck);
    setReturnToCheck(false);
    go(next);
  }

  async function save() {
    setBusy(true);
    setSaveErrors([]);
    const shared = sharedFromAnswers(answers);
    const failures: string[] = [];
    for (const person of people) {
      const result = await saveContactConsent(person.id, shared);
      if (!result.ok) failures.push(COPY.failure(contactLabel(person), result.reasons.join(" ")));
    }
    if (failures.length > 0) {
      setBusy(false);
      setSaveErrors(failures);
      toast.error(COPY.failToast, { description: COPY.failToastDetail });
      return;
    }
    toast.success(COPY.toast, { description: COPY.toastDetail });
    await onSaved();
    setBusy(false);
  }

  const hasBack = previousScreen(order, screen, returnToCheck, items.known.length) !== null;
  const card = layout === "card";
  const backControl = hasBack ? (
    card ? (
      <Button type="button" variant="link" onClick={goBack}>
        {COPY.back}
      </Button>
    ) : (
      <BackButton onClick={goBack}>{COPY.back}</BackButton>
    )
  ) : card ? null : (
    <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>
  );

  let body: ReactNode;
  if (screen === "check") {
    const rows = summaryRows(order, items, answers).map((row) => ({
      label: row.label,
      value: row.value,
      onChange: () => change(row.key),
    }));
    body = (
      <CheckAnswers
        layout={layout}
        titleAs={titleAs}
        title={COPY.checkTitle(org)}
        rows={rows}
        canAddMore={!extras && items.missing.length > 0}
        onAddMore={addMore}
        errors={saveErrors}
        busy={busy}
        onSave={() => void save()}
        back={backControl}
        detailsHref={detailsHref}
      />
    );
  } else {
    const key = screen;
    body = (
      <ChoiceQuestion
        layout={layout}
        titleAs={titleAs}
        fieldKey={key}
        question={COPY.question(org, key)}
        value={items.known.find((item) => item.key === key)?.value ?? COPY.later}
        answer={answers[key]}
        onAnswer={(answer) => {
          setChoiceError(undefined);
          setAnswers((current) => ({ ...current, [key]: answer }));
        }}
        error={choiceError}
        onSubmit={() => answerQuestion(key)}
        back={backControl}
        detailsHref={detailsHref}
      />
    );
  }

  return (
    <div ref={focusRef} data-testid="consent-flow" data-screen={screen}>
      <StepTransition stepKey={screen}>{body}</StepTransition>
    </div>
  );
}

interface ChoiceQuestionProps {
  layout: ConsentLayout;
  titleAs: "h1" | "h2";
  fieldKey: ShareableFieldKey;
  question: string;
  value: string;
  answer: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
  error?: string;
  onSubmit: () => void;
  back: ReactNode;
  detailsHref?: string;
}

function Choices({ id, labelledBy, label, answer, onAnswer, describedBy }: {
  id?: string;
  labelledBy?: string;
  label?: string;
  answer: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
  describedBy?: string;
}) {
  return (
    <RadioGroup
      id={id}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
      value={answer ?? ""}
      onValueChange={(next) => onAnswer(next === "yes" ? "yes" : "no")}
    >
      <ChoiceRow title={COPY.yes}>
        <RadioGroupItem value="yes" aria-label={COPY.yes} />
      </ChoiceRow>
      <ChoiceRow title={COPY.no}>
        <RadioGroupItem value="no" aria-label={COPY.no} />
      </ChoiceRow>
    </RadioGroup>
  );
}

function ValueWell({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="m-0 rounded-md bg-paper-2 px-4 py-3 text-body text-ink [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

function ChoiceQuestion({ layout, titleAs, fieldKey, question, value, answer, onAnswer, error, onSubmit, back, detailsHref }: ChoiceQuestionProps) {
  const controlId = `consent-${fieldKey}`;
  const valueId = `${controlId}-value`;

  if (layout === "page") {
    return (
      <Question
        kind="fieldset"
        questionAs={titleAs}
        controlId={controlId}
        question={question}
        error={error}
        back={back}
        submitLabel={COPY.continue}
        onSubmit={onSubmit}
      >
        <ValueWell id={valueId}>{value}</ValueWell>
        <Choices label={question} describedBy={valueId} answer={answer} onAnswer={onAnswer} />
      </Question>
    );
  }

  const formId = `${controlId}-form`;
  const titleId = `${controlId}-title`;
  const errorId = `${controlId}-error`;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <ActionFrame
      kind={KIND}
      title={<span id={titleId}>{question}</span>}
      detailsHref={detailsHref}
      action={
        <Button type="submit" form={formId} size="lg">
          {COPY.continue}
        </Button>
      }
      secondaryAction={back ?? undefined}
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4">
        <ErrorSummary errors={error ? [{ fieldId: controlId, message: error }] : []} />
        <ValueWell id={valueId}>{value}</ValueWell>
        {error ? (
          <p id={errorId} className="m-0 text-body font-semibold text-danger">
            <span className="sr-only">{COPY.errorPrefix}</span>
            {error}
          </p>
        ) : null}
        <Choices
          id={controlId}
          labelledBy={titleId}
          describedBy={[valueId, error ? errorId : null].filter(Boolean).join(" ")}
          answer={answer}
          onAnswer={onAnswer}
        />
      </form>
    </ActionFrame>
  );
}

interface CheckAnswersProps {
  layout: ConsentLayout;
  titleAs: "h1" | "h2";
  title: string;
  rows: { label: string; value: string; onChange: () => void }[];
  canAddMore: boolean;
  onAddMore: () => void;
  errors: string[];
  busy: boolean;
  onSave: () => void;
  back: ReactNode;
  detailsHref?: string;
}

function CheckAnswers({ layout, titleAs, title, rows, canAddMore, onAddMore, errors, busy, onSave, back, detailsHref }: CheckAnswersProps) {
  const summary = <SummaryList rows={rows} />;
  const addMore = canAddMore ? (
    <div>
      <Button type="button" variant="link" onClick={onAddMore}>
        {COPY.addMore}
      </Button>
    </div>
  ) : null;
  const saveButton = (
    <Button type="button" size="lg" loading={busy} loadingText={COPY.saving} onClick={onSave}>
      {COPY.save}
    </Button>
  );

  if (layout === "card") {
    return (
      <ActionFrame
        kind={KIND}
        title={title}
        lede={COPY.checkLede}
        detailsHref={detailsHref}
        action={saveButton}
        secondaryAction={back ?? undefined}
        reassurance={COPY.reassurance}
      >
        <ActionError messages={errors} />
        {summary}
        {addMore}
      </ActionFrame>
    );
  }

  return (
    <div className="grid max-w-patient gap-6">
      {back ? <div>{back}</div> : null}
      <PageHeader as={titleAs} title={title} lede={COPY.checkLede} className="mb-0" />
      <ActionError messages={errors} />
      {summary}
      {addMore}
      <div className="grid gap-3">
        <div>{saveButton}</div>
        <p className="m-0 text-small text-ink-2">{COPY.reassurance}</p>
      </div>
    </div>
  );
}
