"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Mail, MousePointerClick, PhoneCall } from "lucide-react";
import { Button, LoadingState, Skeleton, toast } from "@/components/ui";
import { approveContactDraft, contactLabel, createContactDraft, loadCase, type ApiContact, type ApiDraft } from "@/components/outreach/client";
import { loadCaseContacts } from "@/components/outreach/case-activity";
import { fieldValue, type ShareableFieldKey } from "@/components/outreach/fields";
import { usePlanApproval } from "../flows/plan/usePlanApproval";
import { hasDisclosure } from "@/lib/safety/disclosure";
import { planLine, shareLabel } from "@/lib/patient-status/plain";
import type { CaseInput } from "@/lib/contracts";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

/** Every patient-visible string on this card, for the readability check. */
export const APPROVE_ALL_COPY = {
  title: "Here's what we'll send",
  lede: "Read each message. One tap approves them all, and then we send.",
  loading: "Writing the messages",
  listLabel: "Messages to approve",
  read: "Read it all",
  shares: "Shares",
  shareNothing: "None of your details",
  email: "Email",
  call: "Call",
  action: (count: number) => (count === 1 ? "Approve it and start" : `Approve all ${count} and start`),
  busy: "Approving",
  reassurance: "Nothing is sent without your OK. Every message says an AI helped write it.",
  noDisclosure: "One message is missing the line that says AI helped write it. So we can't send it.",
  changed: "A message changed",
  changedDetail: "Please read the new version. Nothing was sent.",
  stopped: "Our safety check stopped this message",
  failed: (name: string, reasons: string) => `${name}: ${reasons}`,
  sent: "Approved",
  sentDetail: "We'll tell you when they reply.",
  heldBack: (count: number) => (count === 1 ? "1 message changed" : `${count} messages changed`),
  heldBackDetail: "Please read the new version before we send it.",
  noMessages: "No messages are ready yet. Check back in a moment.",
} as const;

type Row = { contact: ApiContact; draft: ApiDraft };

/**
 * Plan and messages on one screen. Every message is written out, then ONE approval covers the plan and each message.
 * The patient's tap is the approval: the server still sets approved_at per message and runs the outbound gate on each.
 * Before approving, every draft is re-read; if any changed since it was shown, nothing is approved.
 */
export function ApproveAllCard({ caseId, onDone, detailsHref }: ActionProps & { detailsHref: string; headline?: string }) {
  const { plan, errors: planErrors, approve: approvePlan } = usePlanApproval(caseId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [record, setRecord] = useState<CaseInput | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [contacts, found] = await Promise.all([loadCaseContacts(caseId), loadCase(caseId)]);
      const drafts = await Promise.all(
        (contacts ?? []).map(async (contact) => ({ contact, result: await createContactDraft(contact.id) })),
      );
      if (!active) return;
      setRecord(found);
      setRows(drafts.flatMap(({ contact, result }) => (result.ok ? [{ contact, draft: result.draft }] : [])));
      const failed = drafts.flatMap(({ contact, result }) => (result.ok ? [] : [APPROVE_ALL_COPY.failed(contactLabel(contact), result.reasons.join(" "))]));
      if (failed.length > 0) setErrors(failed);
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  const missingDisclosure = (rows ?? []).some((row) => !hasDisclosure(row.draft.body));

  async function approveAll() {
    if (!rows || rows.length === 0 || missingDisclosure || !plan) return;
    setBusy(true);
    setErrors([]);
    // Re-read every draft first: approve only exactly what was shown.
    const latest = await Promise.all(rows.map((row) => createContactDraft(row.contact.id)));
    const changed = latest.some((result, i) => {
      if (!result.ok) return true;
      const shown = rows[i]!.draft;
      return result.draft.id !== shown.id || result.draft.body !== shown.body || (result.draft.subject ?? null) !== (shown.subject ?? null);
    });
    if (changed) {
      setRows(rows.map((row, i) => { const r = latest[i]; return r && r.ok ? { ...row, draft: r.draft } : row; }));
      setBusy(false);
      toast.info(APPROVE_ALL_COPY.changed, { description: APPROVE_ALL_COPY.changedDetail });
      return;
    }
    if (!(await approvePlan())) {
      setBusy(false);
      return;
    }
    // Saving the plan can rewrite a draft for the final channel. Approve only a message that still reads exactly as
    // shown; anything that changed is left for the patient to read on its own. Nothing unread is ever approved.
    const current = await Promise.all(rows.map((row) => createContactDraft(row.contact.id)));
    const failures: string[] = [];
    let held = 0;
    await Promise.all(
      rows.map(async (row, i) => {
        const now = current[i];
        const same = now && now.ok && now.draft.body === row.draft.body && (now.draft.subject ?? null) === (row.draft.subject ?? null);
        if (!now || !now.ok || !same) {
          held += 1;
          return;
        }
        const result = await approveContactDraft(row.contact.id, now.draft.id);
        if (!result.ok) failures.push(APPROVE_ALL_COPY.failed(contactLabel(row.contact), result.reasons.join(" ")));
      }),
    );
    if (held > 0) toast.info(APPROVE_ALL_COPY.heldBack(held), { description: APPROVE_ALL_COPY.heldBackDetail });
    if (failures.length > 0) {
      setErrors(failures);
      toast.error(APPROVE_ALL_COPY.stopped, { description: "Nothing unapproved was sent." });
    } else if (held === 0) {
      toast.success(APPROVE_ALL_COPY.sent, { description: APPROVE_ALL_COPY.sentDetail });
    }
    await onDone();
    setBusy(false);
  }

  const loading = !rows && errors.length === 0 && planErrors.length === 0;
  const planByName = new Map((plan?.resources ?? []).map((r) => [r.name, r] as const));
  const ready = rows !== null && rows.length > 0;
  return (
    <ActionFrame
      kind="approve_plan"
      title={APPROVE_ALL_COPY.title}
      lede={APPROVE_ALL_COPY.lede}
      detailsHref={detailsHref}
      action={
        ready ? (
          <Button size="lg" loading={busy} loadingText={APPROVE_ALL_COPY.busy} disabled={missingDisclosure || !plan} onClick={() => void approveAll()}>
            {APPROVE_ALL_COPY.action(rows.length)}
          </Button>
        ) : undefined
      }
      reassurance={ready ? APPROVE_ALL_COPY.reassurance : undefined}
    >
      <ActionError messages={[...errors, ...planErrors]} />
      {loading ? (
        <LoadingState label={APPROVE_ALL_COPY.loading}>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </LoadingState>
      ) : null}
      {rows && rows.length === 0 && errors.length === 0 ? <p className="m-0 text-body text-ink-2">{APPROVE_ALL_COPY.noMessages}</p> : null}
      {missingDisclosure ? <p role="alert" className="m-0 text-body text-warn-ink">{APPROVE_ALL_COPY.noDisclosure}</p> : null}
      {ready ? (
        <ul aria-label={APPROVE_ALL_COPY.listLabel} className="m-0 grid list-none gap-0 p-0">
          {rows.map(({ contact, draft }) => {
            const name = contactLabel(contact);
            const Icon = draft.channel === "voice" ? PhoneCall : contact.channel === "email" ? Mail : MousePointerClick;
            const how = planByName.get(name);
            const shared = record ? draft.sharedFields.map((key) => `${shareLabel(key)}: ${fieldValue(record, key as ShareableFieldKey)}`) : [];
            return (
              <li key={contact.id} className="border-b border-line/60 last:border-b-0">
                <details className="group py-3">
                  <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-sm focus-ring [&::-webkit-details-marker]:hidden">
                    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-body font-semibold text-ink">{name}</span>
                      <span className="text-small text-ink-2">{draft.channel === "voice" ? APPROVE_ALL_COPY.call : APPROVE_ALL_COPY.email}{how ? ` · ${planLine(how.steps)}` : ""}</span>
                      <span className="line-clamp-2 text-small text-ink group-open:hidden [overflow-wrap:anywhere]">{draft.body}</span>
                    </span>
                    <span className="flex min-h-11 items-center gap-1 text-small font-semibold text-ink-2 group-open:hidden">{APPROVE_ALL_COPY.read}<ChevronDown aria-hidden className="size-4" /></span>
                  </summary>
                  <div className="mt-2 grid gap-2 pl-8">
                    {draft.subject ? <p className="m-0 text-body font-semibold text-ink [overflow-wrap:anywhere]">{draft.subject}</p> : null}
                    <p className="m-0 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-paper-2 p-3 text-body text-ink [overflow-wrap:anywhere]" tabIndex={0} aria-label={`Message to ${name}`}>{draft.body}</p>
                    <p className="m-0 text-small text-ink-2">{APPROVE_ALL_COPY.shares}: {shared.length > 0 ? shared.join("; ") : APPROVE_ALL_COPY.shareNothing}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}
    </ActionFrame>
  );
}
