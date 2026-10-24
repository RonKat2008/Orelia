"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Case, CaseInput } from "@/lib/contracts";
import { goalSchema } from "@/lib/contracts";
import type { DemoReport } from "./demos";
import { confirmAndResearch, extractCase } from "./case-client";

const GOAL_LABELS: Record<(typeof goalSchema.options)[number], string> = {
  second_opinion: "Second opinion",
  treatment: "Treatment center",
  trial: "Clinical trial",
  support: "Advocacy and support",
  aid: "Financial or travel aid",
};

type Props = { demos: DemoReport[] };

export function IntakeFlow({ demos }: Props) {
  const router = useRouter();
  const [reportText, setReportText] = useState("");
  const [draft, setDraft] = useState<Case | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demoId, setDemoId] = useState(demos[0]?.id ?? "");

  const selectedDemo = useMemo(
    () => demos.find((demo) => demo.id === demoId) ?? demos[0],
    [demoId, demos],
  );

  function fallbackFor(text: string): CaseInput {
    const trimmed = text.trim();
    const matched =
      demos.find((demo) => demo.reportText.trim() === trimmed) ??
      demos.find((demo) => trimmed.includes(demo.input.diseaseName));
    if (matched) return matched.input;
    return { diseaseName: "Needs review", goals: [] };
  }

  async function onExtract() {
    if (!reportText.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const { record, preview } = await extractCase(reportText, fallbackFor(reportText));
      setDraft(record);
      setMessage(
        preview
          ? "The research service is not connected yet, so known demo reports are filled from the fixture. Other reports need you to type the fields. Edit anything that does not match, then confirm."
          : "Review the fields below. Edit anything that does not match the report, then confirm.",
      );
    } catch {
      setMessage("Wayfinder could not read that report. Try a demo case or paste the text again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setReportText(text);
    setDraft(null);
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

  async function onConfirm() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      await confirmAndResearch(draft);
      router.push(`/cases/${draft.id}/swarm`);
    } catch {
      setMessage("Those fields could not be saved. Check required disease name and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="report-heading">
        <h2 id="report-heading">Your report</h2>
        <p className="meta">
          Paste a synthetic report or upload a text file. Wayfinder extracts the details it needs to
          search. It does not interpret the diagnosis.
        </p>
        <div className="row">
          <label className="field" style={{ flex: "1 1 220px" }}>
            <span>Demo case</span>
            <select value={demoId} onChange={(event) => setDemoId(event.target.value)}>
              {demos.map((demo) => (
                <option key={demo.id} value={demo.id}>
                  {demo.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!selectedDemo) return;
              setReportText(selectedDemo.reportText);
              setDraft(null);
              setMessage(null);
            }}
          >
            Load demo case
          </button>
        </div>
        <label className="field">
          <span>Report text</span>
          <textarea
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            placeholder="Paste the report here"
          />
        </label>
        <label className="field">
          <span>Upload a .txt or .md file</span>
          <input
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>
        <div className="row">
          <button type="button" onClick={() => void onExtract()} disabled={busy || !reportText.trim()}>
            {busy && !draft ? "Reading report…" : "Extract fields"}
          </button>
        </div>
      </section>

      {draft ? (
        <section className="panel stack" aria-labelledby="fields-heading">
          <h2 id="fields-heading">Extracted case</h2>
          <div className="grid-2">
            <label className="field">
              <span>Disease name</span>
              <input
                type="text"
                required
                value={draft.diseaseName}
                onChange={(event) => update("diseaseName", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Subtype</span>
              <input
                type="text"
                value={draft.subtype ?? ""}
                onChange={(event) => update("subtype", event.target.value || undefined)}
              />
            </label>
            <label className="field">
              <span>Home city</span>
              <input
                type="text"
                value={draft.homeCity ?? ""}
                onChange={(event) => update("homeCity", event.target.value || undefined)}
              />
            </label>
            <label className="field">
              <span>Home state</span>
              <input
                type="text"
                value={draft.homeState ?? ""}
                onChange={(event) => update("homeState", event.target.value || undefined)}
              />
            </label>
            <label className="field">
              <span>Insurer</span>
              <input
                type="text"
                value={draft.insurer ?? ""}
                onChange={(event) => update("insurer", event.target.value || undefined)}
              />
            </label>
            <label className="field">
              <span>Travel limit (miles)</span>
              <input
                type="number"
                min={0}
                value={draft.travelLimitMiles ?? ""}
                onChange={(event) =>
                  update(
                    "travelLimitMiles",
                    event.target.value === "" ? undefined : Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Stage summary, as written in the report</span>
            <textarea
              value={draft.stageSummary ?? ""}
              onChange={(event) => update("stageSummary", event.target.value || undefined)}
            />
          </label>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>What you want help finding</legend>
            {goalSchema.options.map((goal) => (
              <label key={goal} className="check">
                <input
                  type="checkbox"
                  checked={draft.goals.includes(goal)}
                  onChange={() => toggleGoal(goal)}
                />
                <span>{GOAL_LABELS[goal]}</span>
              </label>
            ))}
          </fieldset>
          <div className="row">
            <button type="button" onClick={() => void onConfirm()} disabled={busy || !draft.diseaseName.trim()}>
              {busy ? "Starting research…" : "Confirm and start research"}
            </button>
          </div>
        </section>
      ) : null}

      {message ? <p className="notice">{message}</p> : null}
    </div>
  );
}
