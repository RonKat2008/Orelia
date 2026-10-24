"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton, SummaryList, toast } from "@/components/ui";
import { confirmAndResearch } from "@/components/intake/case-client";
import { caseSchema, type Case } from "@/lib/contracts";
import { PATIENT_HOME_COPY } from "../copy";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

const COPY = PATIENT_HOME_COPY.confirm;

/** A case that was read but never confirmed: show what we have and start the search for THIS case. */
export function ConfirmCard({ caseId, onDone }: ActionProps & { headline?: string }) {
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
      toast.success(COPY.toast);
      await onDone();
    } catch {
      setErrors([COPY.startFailed]);
    }
    setBusy(false);
  }

  const rows = record
    ? [
        { label: COPY.rows.condition, value: record.diseaseName },
        { label: COPY.rows.home, value: [record.homeCity, record.homeState].filter(Boolean).join(", ") || undefined },
        { label: COPY.rows.travel, value: typeof record.travelLimitMiles === "number" ? COPY.travel(record.travelLimitMiles) : undefined },
        { label: COPY.rows.goals, value: record.goals.map((g) => COPY.goals[g] ?? g).join(", ") || undefined },
        { label: COPY.rows.insurance, value: record.insurer },
      ]
    : [];

  return (
    <ActionFrame
      kind="confirm_details"
      title={COPY.title}
      action={
        record ? (
          <Button size="lg" loading={busy} loadingText={COPY.busy} onClick={() => void start()}>
            {COPY.action}
          </Button>
        ) : undefined
      }
    >
      {record === undefined ? <Skeleton className="h-40 w-full" /> : null}
      {record === null ? <ActionError messages={[COPY.loadFailed]} /> : null}
      <ActionError messages={errors} />
      {record ? <SummaryList rows={rows} /> : null}
    </ActionFrame>
  );
}
