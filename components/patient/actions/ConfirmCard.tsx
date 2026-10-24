"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton, toast } from "@/components/ui";
import { confirmAndResearch } from "@/components/intake/case-client";
import { caseSchema, type Case } from "@/lib/contracts";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

const GOALS: Record<string, string> = {
  second_opinion: "A second opinion",
  treatment: "Treatment at a specialist center",
  trial: "A clinical trial",
  support: "Support",
  aid: "Help with money or travel",
};

/** A case that was read but never confirmed: show what we have and start the search for THIS case. */
export function ConfirmCard({ caseId, onDone, headline }: ActionProps & { headline: string }) {
  const [record, setRecord] = useState<Case | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/cases/${caseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (!active) return;
        const parsed = caseSchema.safeParse((body as { case?: unknown } | null)?.case);
        setRecord(parsed.success ? parsed.data : null);
      })
      .catch(() => active && setRecord(null));
    return () => {
      active = false;
    };
  }, [caseId]);

  async function start() {
    if (!record) return;
    setBusy(true);
    setErrors([]);
    try {
      await confirmAndResearch(record);
      toast.success("Your search has started");
      await onDone();
    } catch {
      setErrors(["We couldn't start the search. Nothing was sent to anyone. Please try again."]);
    }
    setBusy(false);
  }

  const rows: [string, string | undefined][] = record
    ? [
        ["Condition", record.diseaseName],
        ["Where you live", [record.homeCity, record.homeState].filter(Boolean).join(", ") || undefined],
        ["How far you can travel", typeof record.travelLimitMiles === "number" ? `Up to ${record.travelLimitMiles} miles` : undefined],
        ["Hoping for", record.goals.map((g) => GOALS[g] ?? g).join(", ") || undefined],
        ["Insurance", record.insurer],
      ]
    : [];

  return (
    <ActionFrame kind="confirm_details" title="Is this right?" lede={headline}>
      {record === undefined ? <Skeleton className="h-40 w-full" /> : null}
      {record === null ? <ActionError messages={["We couldn't load your details. Please try again in a moment."]} /> : null}
      {record ? (
        <>
          <dl className="m-0 grid gap-0 rounded-md border border-line bg-card">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-0.5 border-t border-line px-4 py-3 first:border-t-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-small font-semibold text-ink-2">{label}</dt>
                <dd className="m-0 text-body text-ink [overflow-wrap:anywhere]">{value || "Not given"}</dd>
              </div>
            ))}
          </dl>
          <ActionError messages={errors} />
          <div>
            <Button size="lg" loading={busy} loadingText="Starting" onClick={() => void start()}>
              Looks right, start looking
            </Button>
          </div>
        </>
      ) : null}
    </ActionFrame>
  );
}
