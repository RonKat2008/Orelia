"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BackLink,
  Button,
  Checkbox,
  EmptyState,
  LoadingState,
  PageHeader,
  Skeleton,
  toast,
} from "@/components/ui";
import { contactLabel, saveContactConsent, type ApiContact } from "@/components/outreach/client";
import { SHAREABLE_FIELDS, type ShareableFieldKey } from "@/components/outreach/fields";
import type { CaseInput } from "@/lib/contracts";
import { ActionError, ActionFrame } from "../../actions/ActionFrame";
import { CONSENT_COPY as COPY } from "./copy";
import { audienceLabel, consentItems, minimumFields, NEEDED_FOR, sharedFromAnswers, type ConsentAnswers } from "./logic";
import { useConsentTargets } from "./useConsentTargets";

export interface ConsentChecklistProps {
  caseId: string;
  layout: "card" | "page";
  titleAs?: "h1" | "h2";
  detailsHref?: string;
  onSaved: () => Promise<void> | void;
}

export const CHECKLIST_COPY = {
  title: (org: string) => `What may we tell ${org}?`,
  lede: "We ticked the least they need. Tick or untick anything.",
  save: "Save and continue",
} as const;

/**
 * Patient consent on one screen. The smallest set each kind of resource needs is ticked, each tick says why, and
 * every box can be changed. One tap saves. Only ticked details are ever shared, and people who already have saved
 * choices keep them.
 */
export function ConsentChecklist({ caseId, layout, titleAs = "h1", detailsHref, onSaved }: ConsentChecklistProps) {
  const targets = useConsentTargets(caseId);
  const back = <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>;

  if (!targets) {
    const skeleton = (
      <LoadingState label={COPY.loading}>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </LoadingState>
    );
    return layout === "card" ? (
      <ActionFrame kind="share_details" title={COPY.pageTitle} detailsHref={detailsHref}>{skeleton}</ActionFrame>
    ) : (
      <div className="grid max-w-patient gap-4">{back}<PageHeader as={titleAs} title={COPY.pageTitle} className="mb-0" />{skeleton}</div>
    );
  }

  if (!targets.record || targets.people.length === 0) {
    const empty = !targets.record
      ? { title: COPY.pageTitle, description: COPY.loadFailed }
      : targets.total === 0 ? COPY.nobody : COPY.done;
    if (layout === "card") {
      return (
        <ActionFrame kind="share_details" title={empty.title} lede={empty.description} detailsHref={detailsHref}>
          {!targets.record ? <ActionError messages={[COPY.loadFailed]} /> : null}
        </ActionFrame>
      );
    }
    return (
      <div className="grid max-w-patient gap-4">
        {back}
        <PageHeader as={titleAs} title={COPY.pageTitle} className="mb-0" />
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={<Link href={`/cases/${caseId}`} className="rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring">{COPY.backToCase}</Link>}
        />
      </div>
    );
  }

  return <Checklist {...{ caseId, layout, titleAs, detailsHref, onSaved }} record={targets.record} people={targets.people} />;
}

function Checklist({ caseId, layout, titleAs, detailsHref, onSaved, record, people }: ConsentChecklistProps & { titleAs: "h1" | "h2"; record: CaseInput; people: ApiContact[] }) {
  const known = useMemo(() => consentItems(record).known, [record]);
  const [answers, setAnswers] = useState<ConsentAnswers>(() => {
    const ticked = new Set(minimumFields(people.map((p) => p.targetKind), known.map((k) => k.key)));
    return Object.fromEntries(known.map((item) => [item.key, ticked.has(item.key) ? "yes" : "no"])) as ConsentAnswers;
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const org = audienceLabel(people.map((p) => contactLabel(p)));

  function toggle(key: ShareableFieldKey, on: boolean) {
    setAnswers((current) => ({ ...current, [key]: on ? "yes" : "no" }));
  }

  async function save() {
    setBusy(true);
    setErrors([]);
    const shared = sharedFromAnswers(answers);
    const failures: string[] = [];
    for (const person of people) {
      const result = await saveContactConsent(person.id, shared);
      if (!result.ok) failures.push(COPY.failure(contactLabel(person), result.reasons.join(" ")));
    }
    if (failures.length > 0) {
      setBusy(false);
      setErrors(failures);
      toast.error(COPY.failToast, { description: COPY.failToastDetail });
      return;
    }
    toast.success(COPY.toast, { description: COPY.toastDetail });
    await onSaved();
    setBusy(false);
  }

  const list = (
    <ul className="m-0 grid list-none gap-0 p-0" aria-label={CHECKLIST_COPY.title(org)}>
      {known.map((item) => {
        const id = `share-${item.key}`;
        const label = SHAREABLE_FIELDS.find((f) => f.key === item.key)?.label ?? item.key;
        const why = NEEDED_FOR[item.key];
        return (
          <li key={item.key} className="border-b border-line/60 last:border-b-0">
            <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
              <Checkbox id={id} className="mt-0.5" checked={answers[item.key] === "yes"} onCheckedChange={(v) => toggle(item.key, v === true)} />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-body font-semibold text-ink">{COPY.label[item.key]}<span className="sr-only"> ({label})</span></span>
                <span className="text-body text-ink [overflow-wrap:anywhere]">{item.value}</span>
                {why && answers[item.key] === "yes" ? <span className="text-small text-ink-2">{why}</span> : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
  const button = (
    <Button type="button" size="lg" loading={busy} loadingText={COPY.saving} onClick={() => void save()}>
      {CHECKLIST_COPY.save}
    </Button>
  );

  if (layout === "card") {
    return (
      <ActionFrame kind="share_details" title={CHECKLIST_COPY.title(org)} lede={CHECKLIST_COPY.lede} detailsHref={detailsHref} action={button} reassurance={COPY.reassurance}>
        <ActionError messages={errors} />
        {list}
      </ActionFrame>
    );
  }
  return (
    <div className="grid max-w-patient gap-4">
      <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>
      <PageHeader as={titleAs} title={CHECKLIST_COPY.title(org)} lede={CHECKLIST_COPY.lede} className="mb-0" />
      <ActionError messages={errors} />
      {list}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">{button}</div>
      <p className="m-0 text-small text-ink-2">{COPY.reassurance}</p>
    </div>
  );
}
