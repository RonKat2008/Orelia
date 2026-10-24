"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Case, CaseInput } from "@/lib/contracts";
import { Reveal } from "@/components/motion/Reveal";
import { Skeleton, Stepper, toast, type StepperStep } from "@/components/ui";
import type { DemoReport } from "./demos";
import { confirmAndResearch, extractCase } from "./case-client";
import { NEEDS_REVIEW, checkUpload, fallbackFor } from "./fallback";
import { ReportStep } from "./ReportStep";
import { ReviewStep } from "./ReviewStep";

const STEPS: StepperStep[] = [
  { id: "report", label: "Share a report", description: "Paste or upload" },
  { id: "review", label: "Confirm the details", description: "Edit anything" },
  { id: "search", label: "Start the search", description: "Nine searches at once" },
];

type Phase = "report" | "reading" | "review" | "starting";

const STEP_INDEX: Record<Phase, number> = { report: 0, reading: 0, review: 1, starting: 2 };

function ReadingState() {
  return (
    <section
      aria-labelledby="reading-heading"
      aria-busy="true"
      className="grid gap-6 rounded-lg border border-line bg-card p-6 shadow-md sm:p-8"
    >
      <div role="status" className="grid gap-1">
        <h2 id="reading-heading" tabIndex={-1} className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Reading the report
        </h2>
        <p className="m-0 text-body text-ink-2">Pulling out the diagnosis, location and coverage details.</p>
      </div>
      <div aria-hidden className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-11 sm:col-span-2" />
        <Skeleton className="h-11" />
        <Skeleton className="h-24" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
    </section>
  );
}

export function IntakeFlow({ demos }: { demos: DemoReport[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("report");
  const [reportText, setReportText] = useState("");
  const [draft, setDraft] = useState<Case | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  // Move focus to the new step's heading so keyboard and screen reader users land in the right place.
  const focusKey = phase === "reading" || phase === "starting" ? null : phase;
  const lastFocused = useRef<Phase | null>("report");
  useEffect(() => {
    if (!focusKey || lastFocused.current === focusKey) return;
    lastFocused.current = focusKey;
    const heading = stepRef.current?.querySelector<HTMLElement>("h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: false });
  }, [focusKey]);

  function loadSample(demo: DemoReport) {
    setReportText(demo.reportText);
    setError(null);
    toast.success(`Loaded the ${demo.title} sample`, { description: "Synthetic report. Read it when you are ready." });
  }

  async function loadFile(file: File) {
    const check = checkUpload(file);
    if (!check.ok) {
      setError(check.reason);
      toast.error("That file could not be used", { description: check.reason });
      return;
    }
    try {
      setReportText(await file.text());
      setError(null);
      toast.success(`Added ${file.name}`);
    } catch {
      setError("That file could not be read. Try pasting the text instead.");
    }
  }

  async function readReport() {
    if (!reportText.trim()) return;
    setPhase("reading");
    setError(null);
    try {
      const { record, preview: isPreview } = await extractCase(reportText, fallbackFor(reportText, demos));
      setDraft(record.diseaseName === NEEDS_REVIEW ? { ...record, diseaseName: "" } : record);
      setPreview(isPreview);
      setPhase("review");
      toast.success("Report read", { description: "Check each detail before the search starts." });
    } catch {
      setPhase("report");
      setError("Wayfinder could not read that report. Try a sample case, or paste the text again.");
    }
  }

  function update<K extends keyof CaseInput>(key: K, value: CaseInput[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function toggleGoal(goal: CaseInput["goals"][number]) {
    setDraft((current) => {
      if (!current) return current;
      const goals = current.goals.includes(goal)
        ? current.goals.filter((item) => item !== goal)
        : [...current.goals, goal];
      return { ...current, goals };
    });
  }

  async function startSearch() {
    if (!draft) return;
    setPhase("starting");
    setError(null);
    try {
      await confirmAndResearch(draft);
      router.push(`/cases/${draft.id}/swarm`);
    } catch {
      setPhase("review");
      setError("Those details could not be saved. Check the diagnosis and try again.");
      toast.error("The search did not start");
    }
  }

  return (
    <div className="grid gap-10">
      <Stepper steps={STEPS} current={STEP_INDEX[phase]} aria-label="Intake progress" />
      <div ref={stepRef}>
        <Reveal revealKey={phase === "reading" ? "reading" : phase === "report" ? "report" : "review"}>
          {phase === "reading" ? (
            <ReadingState />
          ) : draft && phase !== "report" ? (
            <ReviewStep
              draft={draft}
              preview={preview}
              busy={phase === "starting"}
              error={error}
              onChange={update}
              onToggleGoal={toggleGoal}
              onBack={() => {
                setError(null);
                setPhase("report");
              }}
              onConfirm={() => void startSearch()}
            />
          ) : (
            <ReportStep
              demos={demos}
              reportText={reportText}
              busy={false}
              error={error}
              onTextChange={(text) => {
                setReportText(text);
                setError(null);
              }}
              onSample={loadSample}
              onFile={(file) => void loadFile(file)}
              onExtract={() => void readReport()}
            />
          )}
        </Reveal>
      </div>
      <p className="m-0 max-w-prose text-small text-ink-2">
        Wayfinder helps you find and contact people. It does not give medical advice. If symptoms feel urgent, contact
        your care team or call 911.
      </p>
    </div>
  );
}
