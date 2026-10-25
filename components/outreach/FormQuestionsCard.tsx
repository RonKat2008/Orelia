"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, toast } from "@/components/ui";
import { apiApplicationSchema, loadApplications, type ApiApplication } from "./applications";

/** One form question as GET /answers returns it. */
interface Question {
  fieldKey: string;
  label: string;
  required: boolean;
  inputType: "email" | "date" | "tel" | "text";
  suggestion: { value: string; origin: "typed" | "profile" | "earlier" | "demo" } | null;
}

const ORIGIN_LABEL: Record<string, string> = {
  profile: "from your profile",
  demo: "demo patient",
  earlier: "from an earlier form",
};

const answersUrl = (caseId: string, appId: string) =>
  `/api/cases/${encodeURIComponent(caseId)}/applications/${encodeURIComponent(appId)}/answers`;

/** Strip the form's own "*" required marker; we say "required" in words. */
const cleanLabel = (label: string) => label.replace(/\s*\*\s*$/, "").trim();

interface FormQuestionsCardProps {
  caseId: string;
  application: Pick<ApiApplication, "id" | "status" | "missing">;
  /** Called with the re-mapped application after "Save and fill". */
  onSaved?: (next: ApiApplication) => void;
}

/**
 * "This form also asks for:" one input per question the form asks that none of the ticked case fields covers
 * (name, date of birth, email...). Pre-filled from the patient's profile (labelled), saved for this application only,
 * then the form is re-mapped so Approve can go ahead. Health questions are never asked here.
 */
export function FormQuestionsCard({ caseId, application, onSaved }: FormQuestionsCardProps) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const missingKey = application.missing.map((m) => m.fieldKey).join("|");

  useEffect(() => {
    if (application.status !== "draft") return;
    let active = true;
    void fetch(answersUrl(caseId, application.id))
      .then(async (res) => (res.ok ? ((await res.json()) as { questions?: Question[] }) : { questions: [] }))
      .catch(() => ({ questions: [] as Question[] }))
      .then((data) => {
        if (!active) return;
        const qs = data.questions ?? [];
        setQuestions(qs);
        setValues(Object.fromEntries(qs.map((q) => [q.fieldKey, q.suggestion?.value ?? ""])));
        setOrigins(Object.fromEntries(qs.flatMap((q) => (q.suggestion ? [[q.fieldKey, q.suggestion.origin]] : []))));
      });
    return () => {
      active = false;
    };
  }, [caseId, application.id, application.status, missingKey]);

  const medical = application.missing.filter((m) => m.reason === "medical_question");
  const open = (questions ?? []).filter((q) => application.missing.some((m) => m.fieldKey === q.fieldKey));
  if (application.status !== "draft" || (!open.length && !medical.length)) return null;

  async function save() {
    if (!questions) return;
    setBusy(true);
    setIssues({});
    const answers = Object.fromEntries(
      questions.map((q) => [q.fieldKey, { value: values[q.fieldKey] ?? "", origin: origins[q.fieldKey] ?? "typed" }]),
    );
    try {
      const res = await fetch(answersUrl(caseId, application.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) });
      const data = (await res.json().catch(() => ({}))) as { application?: unknown; issues?: { fieldKey: string; message: string }[]; error?: string };
      if (!res.ok) {
        if (data.issues?.length) setIssues(Object.fromEntries(data.issues.map((i) => [i.fieldKey, i.message])));
        toast.error("Those answers were not saved", { description: data.issues?.length ? "Check the highlighted fields." : "Please try again." });
        return;
      }
      const parsed = apiApplicationSchema.safeParse(data.application);
      const next = parsed.success ? parsed.data : (await loadApplications(caseId)).find((a) => a.id === application.id);
      if (next) onSaved?.(next);
      toast.success("Saved and filled", { description: "Your answers are used for this form only." });
    } catch {
      toast.error("Could not reach the server", { description: "Nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`fq-${application.id}`} className="grid gap-3 rounded-md border border-line bg-paper-2 p-4" data-testid="form-questions">
      <h4 id={`fq-${application.id}`} className="m-0 text-body font-semibold text-ink">This form also asks for:</h4>
      {questions === null ? <p className="m-0 text-small text-ink-2">Loading the form&apos;s questions…</p> : null}
      {open.length ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {open.map((q) => {
            const id = `fq-${application.id}-${q.fieldKey}`;
            const origin = origins[q.fieldKey];
            const tag = origin && values[q.fieldKey] ? ORIGIN_LABEL[origin] : undefined;
            return (
              <Field key={q.fieldKey} htmlFor={id} label={cleanLabel(q.label)} optional={!q.required} hint={tag} error={issues[q.fieldKey]}>
                <Input
                  id={id}
                  name={q.fieldKey}
                  type={q.inputType}
                  value={values[q.fieldKey] ?? ""}
                  maxLength={200}
                  required={q.required}
                  aria-invalid={issues[q.fieldKey] ? true : undefined}
                  aria-describedby={[tag ? `${id}-hint` : "", issues[q.fieldKey] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((prev) => ({ ...prev, [q.fieldKey]: v }));
                    setOrigins((prev) => ({ ...prev, [q.fieldKey]: "typed" }));
                  }}
                />
              </Field>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={busy} loadingText="Saving">Save and fill</Button>
            <p className="m-0 text-small text-ink-2">Used for this form only. You still approve before anything is sent.</p>
          </div>
        </form>
      ) : null}
      {medical.length ? (
        <p className="m-0 text-small text-ink-2">
          Health questions ({medical.map((m) => cleanLabel(m.label || m.fieldKey)).join(", ")}) are never filled in for you: ask your care team.
        </p>
      ) : null}
    </section>
  );
}

/** Every waiting application on a case that still has questions, each with its card (live console, agent cards). */
export function PendingFormQuestions({ caseId, applicationIds, className }: { caseId: string; applicationIds?: readonly string[]; className?: string }) {
  const [apps, setApps] = useState<ApiApplication[]>([]);
  const filter = applicationIds?.join("|");
  useEffect(() => {
    let active = true;
    void loadApplications(caseId).then((rows) => {
      if (!active) return;
      const wanted = filter ? new Set(filter.split("|")) : null;
      setApps(rows.filter((r) => r.status === "draft" && r.missing.length > 0 && (!wanted || wanted.has(r.id))));
    });
    return () => {
      active = false;
    };
  }, [caseId, filter]);
  if (!apps.length) return null;
  return (
    <div className={className ? `grid gap-3 ${className}` : "grid gap-3"}>
      {apps.map((app) => (
        <FormQuestionsCard key={app.id} caseId={caseId} application={app} onSaved={(next) => setApps((prev) => prev.map((a) => (a.id === next.id ? next : a)))} />
      ))}
    </div>
  );
}
