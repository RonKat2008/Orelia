"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Compass } from "lucide-react";
import type { Case, CaseInput } from "@/lib/contracts";
import { Reveal } from "@/components/motion/Reveal";
import { Button, Checkbox, ChoiceRow, Input, Label, Progress, RadioGroup, RadioGroupItem } from "@/components/ui";
import type { DemoReport } from "../demos";
import { confirmAndResearch, extractCase } from "../case-client";
import { NEEDS_REVIEW, checkUpload, fallbackFor } from "../fallback";
import { GOAL_LABELS, type Goal } from "../goals";
import { ReportStep } from "../ReportStep";
import {
  MAX_CONDITION_LENGTH,
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
  type PatientAnswers,
  type PatientQuestionId,
  type TravelChoice,
} from "./answers";
import { useProfilePrefill } from "./useProfilePrefill";

type Phase = "questions" | "upload" | "reading" | "confirm";

const TOTAL = PATIENT_QUESTIONS.length;
const TRAVEL_CHOICES: readonly TravelChoice[] = ["local", "regional", "far", "anywhere"];
const GOALS: readonly Goal[] = ["second_opinion", "treatment", "trial", "support", "aid"];
const GOAL_CHOICE_TITLES: Record<Goal, string> = {
  second_opinion: "A second opinion",
  treatment: "Treatment at a specialist center",
  trial: "A clinical trial",
  support: "Support from people who understand",
  aid: "Help with money or travel",
};
const START_ERROR = "We could not start your search. Nothing was sent to anyone. Please try again.";
const FOOTER =
  "Wayfinder helps you find and contact people. It does not give medical advice. If symptoms feel urgent, contact your care team or call 911.";

const headingClass = "m-0 font-display text-h2 font-light text-ink display-soft text-balance outline-none";

function recordToAnswers(record: Case): PatientAnswers {
  const miles = record.travelLimitMiles;
  const travel: TravelChoice | null =
    miles === undefined ? null : miles <= 25 ? "local" : miles <= 100 ? "regional" : miles <= 500 ? "far" : "anywhere";
  return {
    condition: record.diseaseName === NEEDS_REVIEW ? "" : record.diseaseName,
    city: record.homeCity ?? "",
    state: record.homeState ?? "",
    travel,
    goals: record.goals,
    insurer: record.insurer ?? "",
  };
}

function travelSummary(travel: TravelChoice | null): string {
  if (!travel) return "";
  const miles = TRAVEL_MILES[travel];
  return miles === undefined ? "Anywhere it takes" : `Up to ${miles} miles`;
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-body text-ink">
      {children}
    </p>
  );
}

type QuestionProps = {
  answers: PatientAnswers;
  onChange: (next: PatientAnswers) => void;
  headingRef: (el: HTMLHeadingElement | null) => void;
};

function Heading({ id, headingRef, children }: { id: string; headingRef: QuestionProps["headingRef"]; children: ReactNode }) {
  return (
    <h2 id={id} ref={headingRef} tabIndex={-1} className={headingClass}>
      {children}
    </h2>
  );
}

function ConditionQuestion({ answers, onChange, headingRef }: QuestionProps) {
  const tooLong = answers.condition.trim().length > MAX_CONDITION_LENGTH;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading id="q-condition" headingRef={headingRef}>
          What condition are you looking for help with?
        </Heading>
        <p id="q-condition-hint" className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          The name on your report is perfect, for example vascular Ehlers-Danlos syndrome.
        </p>
      </div>
      <div className="grid gap-2">
        <Input
          autoComplete="off"
          enterKeyHint="next"
          aria-labelledby="q-condition"
          aria-describedby="q-condition-hint q-condition-error"
          aria-invalid={tooLong || undefined}
          value={answers.condition}
          onChange={(event) => onChange({ ...answers, condition: event.target.value })}
          className="h-13 text-lead"
        />
        {tooLong ? (
          <p id="q-condition-error" role="alert" className="m-0 text-small font-semibold text-danger">
            Please keep this under {MAX_CONDITION_LENGTH} characters.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function HomeQuestion({ answers, onChange, headingRef }: QuestionProps) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading id="q-home" headingRef={headingRef}>
          Where do you live?
        </Heading>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          We use this to find places you could realistically get to. A city or a state is enough.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label htmlFor="q-city">City</Label>
          <Input
            id="q-city"
            autoComplete="address-level2"
            enterKeyHint="next"
            value={answers.city}
            onChange={(event) => onChange({ ...answers, city: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="q-state">State</Label>
          <Input
            id="q-state"
            autoComplete="address-level1"
            enterKeyHint="next"
            value={answers.state}
            onChange={(event) => onChange({ ...answers, state: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function TravelQuestion({ answers, onChange, headingRef }: QuestionProps) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading id="q-travel" headingRef={headingRef}>
          How far could you travel?
        </Heading>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          Pick what feels doable. You can always change this later.
        </p>
      </div>
      <RadioGroup
        aria-labelledby="q-travel"
        value={answers.travel ?? ""}
        onValueChange={(value) => onChange({ ...answers, travel: value as TravelChoice })}
      >
        {TRAVEL_CHOICES.map((choice) => (
          <ChoiceRow key={choice} title={TRAVEL_LABELS[choice]} description={TRAVEL_HINTS[choice]}>
            <RadioGroupItem value={choice} aria-label={TRAVEL_LABELS[choice]} />
          </ChoiceRow>
        ))}
      </RadioGroup>
    </div>
  );
}

function GoalsQuestion({ answers, onChange, headingRef }: QuestionProps) {
  function toggle(goal: Goal) {
    const goals = answers.goals.includes(goal) ? answers.goals.filter((item) => item !== goal) : [...answers.goals, goal];
    onChange({ ...answers, goals });
  }
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading id="q-goals" headingRef={headingRef}>
          What are you hoping for?
        </Heading>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">Choose all that apply.</p>
      </div>
      <div role="group" aria-labelledby="q-goals" className="grid gap-3">
        {GOALS.map((goal) => (
          <ChoiceRow key={goal} title={GOAL_CHOICE_TITLES[goal]}>
            <Checkbox
              checked={answers.goals.includes(goal)}
              onCheckedChange={() => toggle(goal)}
              aria-label={GOAL_CHOICE_TITLES[goal]}
            />
          </ChoiceRow>
        ))}
      </div>
    </div>
  );
}

function InsuranceQuestion({ answers, onChange, headingRef }: QuestionProps) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading id="q-insurance" headingRef={headingRef}>
          Who is your insurance with?
        </Heading>
        <p id="q-insurance-hint" className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          This is optional. It helps us check which centers are likely to take your plan.
        </p>
      </div>
      <Input
        autoComplete="off"
        enterKeyHint="done"
        aria-labelledby="q-insurance"
        aria-describedby="q-insurance-hint"
        value={answers.insurer}
        onChange={(event) => onChange({ ...answers, insurer: event.target.value })}
        className="h-13 text-lead"
      />
    </div>
  );
}

const QUESTION_VIEWS: Record<PatientQuestionId, (props: QuestionProps) => ReactNode> = {
  condition: ConditionQuestion,
  home: HomeQuestion,
  travel: TravelQuestion,
  goals: GoalsQuestion,
  insurance: InsuranceQuestion,
};

function ReadingNote() {
  return (
    <section aria-busy="true" className="grid gap-3 rounded-lg border border-line bg-card p-6 shadow-md sm:p-8">
      <div role="status" className="grid gap-1">
        <h2 className={headingClass}>Reading your report</h2>
        <p className="m-0 text-lead text-ink-2">Pulling out the details. This only takes a moment.</p>
      </div>
    </section>
  );
}

type SummaryProps = {
  answers: PatientAnswers;
  busy: boolean;
  error: string | null;
  headingRef: QuestionProps["headingRef"];
  onChange: (id: PatientQuestionId) => void;
  onStart: () => void;
};

function SummaryScreen({ answers, busy, error, headingRef, onChange, onStart }: SummaryProps) {
  const rows: Array<{ id: PatientQuestionId; label: string; value: string }> = [
    { id: "condition", label: "Condition", value: answers.condition.trim() },
    { id: "home", label: "Where you live", value: [answers.city.trim(), answers.state.trim()].filter(Boolean).join(", ") },
    { id: "travel", label: "How far you could travel", value: travelSummary(answers.travel) },
    {
      id: "goals",
      label: "What you are hoping for",
      value: answers.goals.map((goal) => GOAL_LABELS[goal]).join(", "),
    },
    { id: "insurance", label: "Insurance", value: answers.insurer.trim() },
  ];
  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <Heading id="q-confirm" headingRef={headingRef}>
          Is this right?
        </Heading>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          Here is what you told us. Change anything that is not right.
        </p>
      </div>
      <dl className="m-0 grid divide-y divide-line rounded-lg border border-line bg-card shadow-sm">
        {rows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-4 p-4 sm:px-6">
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-small text-ink-2">{row.label}</dt>
              <dd className="m-0 text-body font-semibold text-ink [overflow-wrap:anywhere]">
                {row.value || <span className="font-normal text-ink-3">Not given</span>}
              </dd>
            </div>
            <Button
              variant="link"
              className="shrink-0 py-3"
              onClick={() => onChange(row.id)}
              disabled={busy}
              aria-label={`Change: ${row.label}`}
            >
              Change
            </Button>
          </div>
        ))}
      </dl>
      <p className="m-0 max-w-prose text-body text-ink-2">Nothing is sent to anyone until you say so.</p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div>
        <Button
          size="lg"
          onClick={onStart}
          loading={busy}
          loadingText="Starting your search..."
          disabled={!answers.condition.trim()}
        >
          <Compass aria-hidden />
          {error ? "Try again" : "Start looking"}
        </Button>
      </div>
    </div>
  );
}

export function PatientIntake({ demos }: { demos: DemoReport[] }) {
  const router = useRouter();
  const profile = useProfilePrefill();
  const [answers, setAnswers] = useState<PatientAnswers>(() => applyProfilePrefill(emptyAnswers(), profile));
  const [prefilled, setPrefilled] = useState(profile !== null);
  const [phase, setPhase] = useState<Phase>("questions");
  const [step, setStep] = useState(0);
  const [record, setRecord] = useState<Case | null>(null);
  const [reportText, setReportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moved = useRef(false);

  // Apply a profile that arrives after first render, once (adjusting state during render, not in an effect).
  if (profile !== null && !prefilled) {
    setPrefilled(true);
    setAnswers((current) => applyProfilePrefill(current, profile));
  }

  // Focus each new heading when it mounts, but never on the first page load.
  const headingRef = useCallback((el: HTMLHeadingElement | null) => {
    if (el && moved.current) el.focus();
  }, []);

  const questionId = PATIENT_QUESTIONS[step];
  const valid = canAdvance(questionId, answers);

  function go(next: () => void) {
    moved.current = true;
    setError(null);
    next();
  }

  function advance() {
    if (!valid) return;
    go(() => (step === TOTAL - 1 ? setPhase("confirm") : setStep(step + 1)));
  }

  function back() {
    go(() => setStep(Math.max(0, step - 1)));
  }

  function jumpTo(id: PatientQuestionId) {
    go(() => {
      setStep(PATIENT_QUESTIONS.indexOf(id));
      setPhase("questions");
    });
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Radix radios and checkboxes swallow Enter; let it advance when the answer is valid.
    const role = (event.target as HTMLElement).getAttribute("role");
    if (event.key === "Enter" && (role === "radio" || role === "checkbox")) {
      event.preventDefault();
      advance();
    }
  }

  async function loadFile(file: File) {
    const check = checkUpload(file);
    if (!check.ok) return setError(check.reason);
    try {
      setReportText(await file.text());
      setError(null);
    } catch {
      setError("That file could not be read. Try pasting the text instead.");
    }
  }

  async function readReport() {
    if (!reportText.trim()) return;
    go(() => setPhase("reading"));
    try {
      const { record: extracted } = await extractCase(reportText, fallbackFor(reportText, demos));
      setRecord(extracted);
      setAnswers(recordToAnswers(extracted));
      setPhase("confirm");
    } catch {
      setPhase("upload");
      setError("We could not read that report. You can paste the text again, or answer a few questions instead.");
    }
  }

  async function startLooking() {
    setBusy(true);
    setError(null);
    try {
      let extracted = record;
      if (!extracted) {
        const own = answersToCaseInput(answers);
        const fallback: CaseInput = { ...own, diseaseName: own.diseaseName ?? answers.condition.trim(), goals: own.goals ?? [] };
        extracted = (await extractCase(answersToReport(answers), fallback)).record;
      }
      const merged = mergeExtracted(extracted, answers);
      await confirmAndResearch(merged);
      router.push(`/cases/${merged.id}`);
    } catch {
      setError(START_ERROR);
      setBusy(false);
    }
  }

  function renderBody(): { key: string; node: ReactNode } {
    if (phase === "reading") return { key: "reading", node: <ReadingNote /> };
    if (phase === "upload") {
      return {
        key: "upload",
        node: (
          <div className="grid gap-6">
            <ReportStep
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
            <div>
              <Button
                variant="link"
                className="py-3"
                onClick={() => go(() => setPhase("questions"))}
              >
                <ArrowLeft aria-hidden />
                Answer questions instead
              </Button>
            </div>
          </div>
        ),
      };
    }
    if (phase === "confirm") {
      return {
        key: "confirm",
        node: (
          <SummaryScreen
            answers={answers}
            busy={busy}
            error={error}
            headingRef={headingRef}
            onChange={jumpTo}
            onStart={() => void startLooking()}
          />
        ),
      };
    }
    const Question = QUESTION_VIEWS[questionId];
    return {
      key: `q-${questionId}`,
      node: (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            advance();
          }}
          onKeyDown={onFormKeyDown}
          className="grid gap-8"
        >
          <section data-question={questionId} aria-labelledby={`q-${questionId}`}>
            <Question answers={answers} onChange={setAnswers} headingRef={headingRef} />
          </section>
          <div className="flex flex-wrap items-center gap-3">
            {step > 0 ? (
              <Button variant="secondary" size="lg" onClick={back}>
                <ArrowLeft aria-hidden />
                Back
              </Button>
            ) : null}
            <Button type="submit" size="lg" disabled={!valid}>
              Next
              <ArrowRight aria-hidden />
            </Button>
            {questionId === "insurance" ? (
              <Button variant="ghost" size="lg" onClick={() => go(() => setPhase("confirm"))}>
                Skip
              </Button>
            ) : null}
          </div>
        </form>
      ),
    };
  }

  const body = renderBody();
  const showProgress = phase === "questions";

  return (
    <div data-testid="patient-intake" className="mx-auto grid w-full max-w-2xl gap-8">
      {showProgress ? (
        <div className="grid gap-3">
          <p className="m-0 text-small font-semibold text-ink-2">
            Question {step + 1} of {TOTAL}
          </p>
          <Progress value={step + 1} max={TOTAL} aria-label="Intake progress" valueText={`Question ${step + 1} of ${TOTAL}`} />
        </div>
      ) : null}
      <Reveal revealKey={body.key}>{body.node}</Reveal>
      {phase === "questions" ? (
        <div className="border-t border-line pt-6">
          <Button variant="link" className="py-3" onClick={() => go(() => setPhase("upload"))}>
            Upload a report or records instead
          </Button>
        </div>
      ) : null}
      <p className="m-0 max-w-prose text-small text-ink-2">{FOOTER}</p>
    </div>
  );
}
