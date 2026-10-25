"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { REPORT_TEXT_MIN, REPORT_TEXT_MAX, type Case, type CaseInput } from "@/lib/contracts";
import {
  Button,
  Checkbox,
  ChoiceRow,
  ErrorSummary,
  Input,
  Label,
  Progress,
  Question,
  RadioGroup,
  RadioGroupItem,
  SummaryList,
} from "@/components/ui";
import type { DemoReport } from "../demos";
import {
  InvalidFields,
  confirmAndResearch,
  extractCase,
} from "../case-client";
import { checkUpload, fallbackFor } from "../fallback";
import { ReportStep } from "../ReportStep";
import {
  PATIENT_QUESTIONS,
  TRAVEL_HINTS,
  TRAVEL_LABELS,
  TRAVEL_MILES,
  answersToCaseInput,
  answersToReport,
  applyProfilePrefill,
  canAdvance,
  emptyAnswers,
  mergeExtracted,
  recordToAnswers,
  questionError,
  type PatientAnswers,
  type PatientQuestionId,
  type TravelChoice,
} from "./answers";
import { BackButton } from "./BackButton";
import { INTAKE_COPY } from "./copy";
import { DocumentsStep } from "./DocumentsStep";
import { StepTransition } from "./StepTransition";
import { useProfilePrefill } from "./useProfilePrefill";

type Phase = "questions" | "upload" | "documents" | "reading" | "confirm";

const COPY = INTAKE_COPY;
const TOTAL = PATIENT_QUESTIONS.length;
const TRAVEL_CHOICES: readonly TravelChoice[] = [
  "local",
  "regional",
  "far",
  "anywhere",
];
const GOALS = [
  "second_opinion",
  "treatment",
  "trial",
  "support",
  "aid",
] as const;
const START_BUTTON_ID = "start-search";
const HEADING_CLASS =
  "m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance outline-none";

const fieldName = (key: string) => COPY.errors.fieldNames[key] ?? key;

function travelSummary(travel: TravelChoice | null, exactMiles?: number): string {
  if (!travel && exactMiles === undefined) return "";
  const miles = exactMiles ?? (travel ? TRAVEL_MILES[travel] : undefined);
  return miles === undefined
    ? COPY.travel.anywhereSummary
    : COPY.travel.milesSummary(miles);
}

type FieldProps = {
  answers: PatientAnswers;
  onChange: (next: PatientAnswers) => void;
};

function QuestionFields({
  id,
  answers,
  onChange,
}: FieldProps & { id: PatientQuestionId }): ReactNode {
  switch (id) {
    case "home":
      return (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label htmlFor="q-city">{COPY.questions.home.city}</Label>
            <Input
              id="q-city"
              autoComplete="address-level2"
              enterKeyHint="next"
              value={answers.city}
              onChange={(event) =>
                onChange({ ...answers, city: event.target.value })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="q-state">{COPY.questions.home.state}</Label>
            <Input
              id="q-state"
              autoComplete="address-level1"
              enterKeyHint="next"
              value={answers.state}
              onChange={(event) =>
                onChange({ ...answers, state: event.target.value })
              }
            />
          </div>
        </div>
      );
    case "travel":
      return (
        <RadioGroup
          aria-label={COPY.questions.travel.question}
          value={answers.travel ?? ""}
          onValueChange={(value) =>
            onChange({ ...answers, travel: value as TravelChoice, travelLimitMiles: undefined })
          }
        >
          {TRAVEL_CHOICES.map((choice) => (
            <ChoiceRow
              key={choice}
              title={TRAVEL_LABELS[choice]}
              description={TRAVEL_HINTS[choice]}
            >
              <RadioGroupItem
                value={choice}
                aria-label={TRAVEL_LABELS[choice]}
              />
            </ChoiceRow>
          ))}
        </RadioGroup>
      );
    case "goals":
      return (
        <div className="grid gap-3">
          {GOALS.map((goal) => (
            <ChoiceRow key={goal} title={COPY.goals[goal]}>
              <Checkbox
                checked={answers.goals.includes(goal)}
                onCheckedChange={() =>
                  onChange({
                    ...answers,
                    goals: answers.goals.includes(goal)
                      ? answers.goals.filter((item) => item !== goal)
                      : [...answers.goals, goal],
                  })
                }
                aria-label={COPY.goals[goal]}
              />
            </ChoiceRow>
          ))}
        </div>
      );
    default:
      return null;
  }
}

type QuestionScreenProps = FieldProps & {
  id: PatientQuestionId;
  showError: boolean;
  back: ReactNode;
  secondary: ReactNode;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function QuestionScreen({
  id,
  answers,
  onChange,
  showError,
  back,
  secondary,
  onSubmit,
  onKeyDown,
}: QuestionScreenProps) {
  const error = showError ? questionError(id, answers) : undefined;
  const copy = COPY.questions[id];

  if (id === "condition" || id === "insurance") {
    const isCondition = id === "condition";
    const value = isCondition ? answers.condition : answers.insurer;
    return (
      <Question
        question={copy.question}
        controlId={`q-${id}`}
        hint={copy.hint}
        optional={!isCondition}
        error={error}
        back={back}
        submitLabel={COPY.actions.continue}
        onSubmit={onSubmit}
        secondary={secondary}
      >
        {(control) => (
          <Input
            id={`q-${id}`}
            autoComplete="off"
            enterKeyHint={isCondition ? "next" : "done"}
            value={value}
            onChange={(event) =>
              onChange(
                isCondition
                  ? { ...answers, condition: event.target.value }
                  : { ...answers, insurer: event.target.value },
              )
            }
            {...control}
          />
        )}
      </Question>
    );
  }

  return (
    <div onKeyDown={onKeyDown}>
      <Question
        kind="fieldset"
        question={copy.question}
        controlId={`q-${id}`}
        hint={copy.hint}
        error={error}
        back={back}
        submitLabel={COPY.actions.continue}
        onSubmit={onSubmit}
        secondary={secondary}
      >
        <QuestionFields id={id} answers={answers} onChange={onChange} />
      </Question>
    </div>
  );
}

type CheckProps = {
  answers: PatientAnswers;
  busy: boolean;
  error: string | null;
  back: ReactNode;
  note?: string;
  onChange: (id: PatientQuestionId) => void;
  onStart: () => void;
};

function CheckScreen({
  answers,
  busy,
  error,
  back,
  note,
  onChange,
  onStart,
}: CheckProps) {
  const rows: Array<{ id: PatientQuestionId; value: string }> = [
    { id: "condition", value: answers.condition.trim() },
    {
      id: "home",
      value: [answers.city.trim(), answers.state.trim()]
        .filter(Boolean)
        .join(", "),
    },
    { id: "travel", value: travelSummary(answers.travel, answers.travelLimitMiles) },
    {
      id: "goals",
      value: answers.goals.map((goal) => COPY.goals[goal]).join(", "),
    },
    { id: "insurance", value: answers.insurer.trim() },
  ];
  return (
    <div className="grid max-w-patient gap-6">
      <div>{back}</div>
      {error ? (
        <ErrorSummary errors={[{ fieldId: START_BUTTON_ID, message: error }]} />
      ) : null}
      <div className="grid gap-3">
        <h1 className={HEADING_CLASS} tabIndex={-1}>
          {COPY.check.title}
        </h1>
        <p className="m-0 max-w-prose text-body text-ink-2">
          {COPY.check.hint}
        </p>
        {note ? (
          <p role="status" className="m-0 max-w-prose text-small font-semibold text-teal-ink dark:text-teal">
            {note}
          </p>
        ) : null}
      </div>
      <SummaryList
        rows={rows.map((row) => ({
          label: COPY.check.rows[row.id],
          value: row.value,
          onChange: busy ? undefined : () => onChange(row.id),
          changeLabel: COPY.check.changeHidden[row.id],
        }))}
      />
      <div className="grid gap-3">
        <div>
          <Button
            id={START_BUTTON_ID}
            size="lg"
            onClick={onStart}
            loading={busy}
            loadingText={COPY.actions.startingSearch}
          >
            {error ? COPY.actions.tryAgain : COPY.actions.startSearch}
          </Button>
        </div>
        <p className="m-0 max-w-prose text-small text-ink-2">
          {COPY.check.reassurance}
        </p>
      </div>
    </div>
  );
}

function ReadingNote() {
  return (
    <section aria-busy="true" className="grid max-w-patient gap-3">
      <div role="status" className="grid gap-3">
        <h1 className={HEADING_CLASS}>{COPY.upload.reading}</h1>
        <p className="m-0 text-body text-ink-2">{COPY.upload.readingNote}</p>
      </div>
    </section>
  );
}

export function PatientIntake({ demos }: { demos: DemoReport[] }) {
  const router = useRouter();
  const profile = useProfilePrefill();
  const [answers, setAnswers] = useState<PatientAnswers>(() =>
    applyProfilePrefill(emptyAnswers(), profile),
  );
  const [prefilled, setPrefilled] = useState(profile !== null);
  const [phase, setPhase] = useState<Phase>("questions");
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [fromCheck, setFromCheck] = useState(false);
  const [record, setRecord] = useState<Case | null>(null);
  const [reportText, setReportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromDocuments, setFromDocuments] = useState(false);
  const adopted = useRef<string | null>(null);
  const moved = useRef(false);
  const busyRef = useRef(false);

  // Apply a profile that arrives after first render, once (adjusting state during render, not in an effect).
  if (profile !== null && !prefilled) {
    setPrefilled(true);
    setAnswers((current) => applyProfilePrefill(current, profile));
  }

  // Focus each new screen's h1 when it mounts, but never on the first page load.
  const landing = useCallback((el: HTMLDivElement | null) => {
    if (!el || !moved.current) return;
    const heading = el.querySelector<HTMLElement>("h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.classList.add("outline-none");
    heading.focus();
  }, []);

  const questionId = PATIENT_QUESTIONS[step];

  function go(next: () => void) {
    if (busyRef.current) return;
    moved.current = true;
    setError(null);
    setSubmitted(false);
    next();
  }

  function advance() {
    if (!canAdvance(questionId, answers)) {
      setSubmitted(true);
      return;
    }
    go(() => {
      if (fromCheck || step === TOTAL - 1) {
        setFromCheck(false);
        setPhase("confirm");
      } else {
        setStep(step + 1);
      }
    });
  }

  function back() {
    go(() => {
      if (fromCheck) {
        setFromCheck(false);
        setPhase("confirm");
      } else {
        setStep(Math.max(0, step - 1));
      }
    });
  }

  function backFromCheck() {
    go(() => {
      setStep(TOTAL - 1);
      setPhase("questions");
    });
  }

  function skipInsurance() {
    go(() => {
      setAnswers((current) => ({ ...current, insurer: "" }));
      setFromCheck(false);
      setPhase("confirm");
    });
  }

  function jumpTo(id: PatientQuestionId) {
    if (busy) return;
    go(() => {
      setStep(PATIENT_QUESTIONS.indexOf(id));
      setPhase("questions");
      setFromCheck(true);
    });
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Radix radios and checkboxes swallow Enter; let it continue, which validates.
    const role = (event.target as HTMLElement).getAttribute("role");
    if (event.key === "Enter" && (role === "radio" || role === "checkbox")) {
      event.preventDefault();
      advance();
    }
  }

  async function loadFile(file: File) {
    if (busyRef.current) return;
    const check = checkUpload(file);
    if (!check.ok) return setError(check.reason);
    try {
      setReportText(await file.text());
      setError(null);
    } catch {
      setError(COPY.upload.unreadable);
    }
  }

  /** Move this browser's draft documents into the case. Fire and forget: the flow never waits on it. */
  function adoptDrafts(caseId: string) {
    if (adopted.current === caseId) return;
    adopted.current = caseId;
    void fetch(`/api/cases/${encodeURIComponent(caseId)}/space/adopt`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  }

  async function readReport(textOverride?: string, from: Phase = "upload") {
    if (busyRef.current || (phase !== "upload" && phase !== "documents")) return;
    const text = textOverride ?? reportText;
    if (!text.trim()) {
      setError(COPY.upload.empty);
      return;
    }
    const length = text.trim().length;
    if (length < REPORT_TEXT_MIN || length > REPORT_TEXT_MAX) {
      setError(`Use between ${REPORT_TEXT_MIN} and ${REPORT_TEXT_MAX.toLocaleString("en-US")} characters from your report.`);
      return;
    }
    go(() => setPhase("reading"));
    busyRef.current = true;
    try {
      const { record: extracted } = await extractCase(
        text,
        fallbackFor(text, demos),
      );
      setRecord(extracted);
      setAnswers(recordToAnswers(extracted));
      setFromCheck(false);
      setFromDocuments(from === "documents");
      adoptDrafts(extracted.id);
      setPhase("confirm");
    } catch (failure) {
      setPhase(from);
      setError(
        failure instanceof Error ? failure.message : COPY.upload.readFailed,
      );
    } finally {
      busyRef.current = false;
    }
  }

  async function fillFromDocuments(ids: string[]) {
    if (busyRef.current || busy) return;
    setBusy(true);
    setError(null);
    let text: string | null = null;
    try {
      const response = await fetch("/api/intake/documents/report?draft=1", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body: unknown = response.ok ? await response.json().catch(() => null) : null;
      const candidate = (body as { reportText?: unknown } | null)?.reportText;
      text = typeof candidate === "string" && candidate.trim() ? candidate : null;
    } catch {
      text = null;
    }
    setBusy(false);
    if (!text) {
      setError(COPY.documents.failed);
      return;
    }
    setReportText(text);
    await readReport(text, "documents");
  }

  async function startLooking() {
    if (busyRef.current || phase !== "confirm") return;
    if (!answers.condition.trim()) {
      // The condition is the one thing the search cannot run without: ask for it on its own screen.
      moved.current = true;
      setStep(PATIENT_QUESTIONS.indexOf("condition"));
      setPhase("questions");
      setFromCheck(true);
      setSubmitted(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let extracted = record;
      if (!extracted) {
        const own = answersToCaseInput(answers);
        const fallback: CaseInput = {
          ...own,
          diseaseName: own.diseaseName ?? answers.condition.trim(),
          goals: own.goals ?? [],
        };
        extracted = (await extractCase(answersToReport(answers), fallback))
          .record;
        // Keep the created case so a retry after a failed save does not create a second one.
        setRecord(extracted);
      }
      adoptDrafts(extracted.id);
      const merged = mergeExtracted(extracted, answers);
      await confirmAndResearch(merged);
      router.push(`/cases/${merged.id}`);
    } catch (failure) {
      setError(
        failure instanceof InvalidFields
          ? COPY.errors.fields(failure.fields.map(fieldName).join(" and "))
          : failure instanceof Error ? failure.message : COPY.errors.start,
      );
      busyRef.current = false;
      setBusy(false);
    }
  }

  function renderBody(): { key: string; node: ReactNode } {
    if (phase === "reading") return { key: "reading", node: <ReadingNote /> };
    if (phase === "upload") {
      return {
        key: "upload",
        node: (
          <div className="grid max-w-3xl gap-6">
            <div>
              <BackButton onClick={() => go(() => setPhase("questions"))}>
                {COPY.actions.answerInstead}
              </BackButton>
            </div>
            <ReportStep
              audience="patient"
              demos={demos}
              reportText={reportText}
              busy={false}
              error={error}
              onTextChange={(text) => {
                setReportText(text);
                setError(null);
              }}
              onSample={(demo) => {
                setReportText(demo.reportText);
                setError(null);
              }}
              onFile={(file) => void loadFile(file)}
              onExtract={() => void readReport()}
            />
          </div>
        ),
      };
    }
    if (phase === "documents") {
      return {
        key: "documents",
        node: (
          <DocumentsStep
            busy={busy}
            error={error}
            onSkip={() => go(() => setPhase("questions"))}
            onFill={(ids) => void fillFromDocuments(ids)}
          />
        ),
      };
    }
    if (phase === "confirm") {
      return {
        key: "confirm",
        node: (
          <CheckScreen
            answers={answers}
            busy={busy}
            error={error}
            note={fromDocuments ? COPY.documents.prefilled : undefined}
            back={
              <BackButton onClick={backFromCheck} disabled={busy}>
                {COPY.actions.back}
              </BackButton>
            }
            onChange={jumpTo}
            onStart={() => void startLooking()}
          />
        ),
      };
    }
    const secondary = (
      <div className="flex flex-wrap items-center gap-x-6">
        {questionId === "insurance" ? (
          <Button variant="link" className="py-3" onClick={skipInsurance}>
            {COPY.actions.skip}
          </Button>
        ) : null}
        <Button
          variant="link"
          className="py-3"
          onClick={() => go(() => setPhase("upload"))}
        >
          {COPY.actions.uploadInstead}
        </Button>
        <Button
          variant="link"
          className="py-3"
          onClick={() => go(() => setPhase("documents"))}
        >
          {COPY.actions.addDocuments}
        </Button>
      </div>
    );
    return {
      key: `q-${questionId}`,
      node: (
        <QuestionScreen
          id={questionId}
          answers={answers}
          onChange={setAnswers}
          showError={submitted}
          back={
            step > 0 || fromCheck ? (
              <BackButton onClick={back}>{COPY.actions.back}</BackButton>
            ) : null
          }
          secondary={secondary}
          onSubmit={advance}
          onKeyDown={onFormKeyDown}
        />
      ),
    };
  }

  const body = renderBody();

  return (
    <div
      data-testid="patient-intake"
      className="grid w-full max-w-patient gap-6"
    >
      {phase === "questions" ? (
        <Progress
          value={step + 1}
          max={TOTAL}
          label={COPY.progress.label}
          valueText={COPY.progress.valueText(step + 1, TOTAL)}
        />
      ) : null}
      <StepTransition stepKey={body.key}>
        <div ref={landing}>{body.node}</div>
      </StepTransition>
    </div>
  );
}
