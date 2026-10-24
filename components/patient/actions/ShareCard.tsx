"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton, Switch, toast } from "@/components/ui";
import { contactLabel, loadCase, saveContactConsent, type ApiContact } from "@/components/outreach/client";
import { loadCaseContacts } from "@/components/outreach/case-activity";
import { SHAREABLE_FIELDS, defaultSharedFields, fieldValue, type ShareableFieldKey } from "@/components/outreach/fields";
import type { CaseInput } from "@/lib/contracts";
import { shareLabel } from "@/lib/patient-status/plain";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

/** Consent as plain toggles. The same choice is saved for every person picked; only ticked fields are ever shared. */
export function ShareCard({ caseId, onDone, detailsHref, headline }: ActionProps & { detailsHref: string; headline: string }) {
  const [record, setRecord] = useState<CaseInput | null>(null);
  const [people, setPeople] = useState<ApiContact[] | null>(null);
  const [shared, setShared] = useState<ShareableFieldKey[]>(defaultSharedFields());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadCase(caseId), loadCaseContacts(caseId)]).then(([found, contacts]) => {
      if (!active) return;
      setRecord(found);
      setPeople(contacts ?? []);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  function toggle(key: ShareableFieldKey, on: boolean) {
    setShared((current) => (on ? [...new Set([...current, key])] : current.filter((k) => k !== key)));
  }

  async function save() {
    if (!people) return;
    setBusy(true);
    setErrors([]);
    const failures: string[] = [];
    for (const person of people) {
      const result = await saveContactConsent(person.id, shared);
      if (!result.ok) failures.push(`${contactLabel(person)}: ${result.reasons.join(" ")}`);
    }
    if (failures.length > 0) {
      setBusy(false);
      setErrors(failures);
      toast.error("Your choices weren't saved for everyone", { description: "Nothing was sent." });
      return;
    }
    toast.success("Saved", { description: "Next, we'll show you how we'll reach them." });
    await onDone();
    setBusy(false);
  }

  return (
    <ActionFrame kind="share_details" title="What may we share?" lede={headline} detailsHref={detailsHref}>
      {!people ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <>
          {people.length > 0 ? (
            <p className="m-0 text-body text-ink-2">
              For: <span className="font-semibold text-ink">{people.map((p) => contactLabel(p)).join(", ")}</span>
            </p>
          ) : null}
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
            {SHAREABLE_FIELDS.map((field) => {
              const id = `share-${field.key}`;
              const value = record ? fieldValue(record, field.key) : "";
              const on = shared.includes(field.key);
              return (
                <li key={field.key} className="flex items-center justify-between gap-4 rounded-md border border-line bg-card px-4 py-3">
                  <label htmlFor={id} className="grid min-w-0 cursor-pointer gap-0.5">
                    <span className="text-body font-semibold text-ink">{shareLabel(field.key)}</span>
                    <span className="text-small text-ink-2 [overflow-wrap:anywhere]">{value || "Not on file"}</span>
                  </label>
                  <Switch id={id} checked={on} onCheckedChange={(next) => toggle(field.key, next === true)} />
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-small text-ink-2">
            Only what&apos;s switched on is ever shared. Every message also says an AI helped write it.
          </p>
          <ActionError messages={errors} />
          <div>
            <Button size="lg" loading={busy} loadingText="Saving" disabled={people.length === 0} onClick={() => void save()}>
              Save what we may share
            </Button>
          </div>
        </>
      )}
    </ActionFrame>
  );
}
