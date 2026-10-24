"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionCard, Button, Skeleton, Surface, toast } from "@/components/ui";
import { approveContactDraft, createContactDraft, loadCase, type ApiDraft } from "@/components/outreach/client";
import { fieldValue, type ShareableFieldKey } from "@/components/outreach/fields";
import type { CaseInput } from "@/lib/contracts";
import { hasDisclosure } from "@/lib/safety/disclosure";
import { shareLabel } from "@/lib/patient-status/plain";
import type { PatientNextAction } from "@/lib/patient-status/types";
import type { ActionProps } from "./ActionFrame";

type Shown = { id: string; channel: "email" | "voice"; subject: string | null; body: string; sharedFields: string[]; address: string | null };

function fromApi(draft: ApiDraft): Shown {
  return { id: draft.id, channel: draft.channel, subject: draft.subject ?? null, body: draft.body, sharedFields: draft.sharedFields, address: draft.address };
}

/** Every patient-visible string on this card, for the readability check. */
export const MESSAGE_COPY = {
  replyTitle: (name: string) => `${name} asked for your records. Here's the reply we wrote.`,
  replySlidesTitle: (name: string) => `${name} asked for your slides. Here's the reply we wrote.`,
  followUpTitle: (name: string) => `Your follow-up to ${name}`,
  callTitle: (name: string) => `Your call script for ${name}`,
  emailTitle: (name: string) => `Your message to ${name}`,
  replyLede: "Read it first. We only send it if you say yes.",
  lede: "Read it first. We only send it when you say so.",
  to: "To",
  calling: "We'll call",
  subject: "Subject",
  whatTheySee: "What they'll see",
  nothingShared: "None of your details. Just the request.",
  noDisclosure: "This message is missing the line that says AI helped write it. So we can't send it.",
  sendEmail: "Send this email",
  sendReply: "Send this reply",
  okCall: "OK this call",
  sending: "Sending",
  change: "Change something",
  skip: "Skip for now",
  reassurance: "Nothing is sent without your OK. Every message says an AI helped write it.",
  heldTitle: "OK, it will wait",
  heldLede: "Nothing is sent until you say so.",
  showAgain: "Show the message again",
  loading: "Writing the message",
  changed: "This message changed",
  changedDetail: "Please read the new version. Nothing was sent.",
  stopped: "Our safety check stopped this message",
  stoppedDetail: "Nothing was sent.",
  tryLater: "You can try again later, or change the message.",
  sent: "Sent",
  sentDetail: "We'll tell you when they reply.",
  queued: "It will go out shortly.",
  callOk: "Call approved",
} as const;

function titleFor(action: PatientNextAction, call: boolean): string {
  const name = action.name ?? "this contact";
  if (action.reply) return action.reply === "slides" ? MESSAGE_COPY.replySlidesTitle(name) : MESSAGE_COPY.replyTitle(name);
  if (action.followUp) return MESSAGE_COPY.followUpTitle(name);
  return call ? MESSAGE_COPY.callTitle(name) : MESSAGE_COPY.emailTitle(name);
}

/**
 * One message, read in full, then "Send this email" / "Change something" / "Skip for now". The send is the
 * patient's click: the server sets approved_at and runs the outbound gate. Nothing here approves on its own.
 * Covers first messages, follow-ups and reply letters (records or slides they asked for).
 */
export function MessageCard({ caseId, onDone, action }: ActionProps & { action: PatientNextAction; headline?: string }) {
  const contactId = action.contactId ?? "";
  const [draft, setDraft] = useState<Shown | null>(null);
  const [record, setRecord] = useState<CaseInput | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    let active = true;
    void loadCase(caseId).then((found) => active && setRecord(found));
    // The server returns the draft waiting for this contact (first message, follow-up or reply letter), matched to
    // the current consent, or writes one. It never approves anything.
    if (contactId) {
      void createContactDraft(contactId).then((result) => {
        if (!active) return;
        if (result.ok) setDraft(fromApi(result.draft));
        else setErrors(result.reasons);
      });
    }
    return () => {
      active = false;
    };
  }, [caseId, contactId]);

  const call = (draft?.channel ?? "email") === "voice";
  const disclosed = draft ? hasDisclosure(draft.body) : false;
  const shared = record && draft ? draft.sharedFields.map((key) => ({ key, value: fieldValue(record, key as ShareableFieldKey) })) : [];

  async function approve() {
    if (!draft || !disclosed) return;
    setBusy(true);
    setErrors([]);
    // Re-read first: if the draft was edited elsewhere since it was shown, show the new text instead of approving it.
    const latest = await createContactDraft(contactId);
    if (latest.ok && (latest.draft.id !== draft.id || latest.draft.body !== draft.body || (latest.draft.subject ?? null) !== draft.subject)) {
      setDraft(fromApi(latest.draft));
      setBusy(false);
      toast.info(MESSAGE_COPY.changed, { description: MESSAGE_COPY.changedDetail });
      return;
    }
    const result = await approveContactDraft(contactId, draft.id);
    if (!result.ok) {
      setBusy(false);
      setErrors(result.reasons);
      toast.error(MESSAGE_COPY.stopped, { description: MESSAGE_COPY.stoppedDetail });
      return;
    }
    toast.success(call ? MESSAGE_COPY.callOk : MESSAGE_COPY.sent, { description: result.sentAt ? MESSAGE_COPY.sentDetail : MESSAGE_COPY.queued });
    await onDone();
    setBusy(false);
  }

  if (held) {
    return (
      <ActionCard
        data-testid="patient-action"
        data-action="approve_message"
        title={MESSAGE_COPY.heldTitle}
        lede={MESSAGE_COPY.heldLede}
        action={
          <Button size="lg" variant="secondary" onClick={() => setHeld(false)}>
            {MESSAGE_COPY.showAgain}
          </Button>
        }
      />
    );
  }

  const primary = action.reply ? MESSAGE_COPY.sendReply : call ? MESSAGE_COPY.okCall : MESSAGE_COPY.sendEmail;
  return (
    <ActionCard
      data-testid="patient-action"
      data-action="approve_message"
      data-reply={action.reply ?? undefined}
      title={titleFor(action, call)}
      lede={action.reply ? MESSAGE_COPY.replyLede : MESSAGE_COPY.lede}
      action={
        draft ? (
          <Button size="lg" loading={busy} loadingText={MESSAGE_COPY.sending} onClick={() => void approve()} disabled={!disclosed}>
            {primary}
          </Button>
        ) : undefined
      }
      secondaryAction={
        draft ? (
          <span className="flex flex-wrap gap-x-6 gap-y-2">
            <Button asChild variant="link">
              <Link href={action.detailsHref}>{MESSAGE_COPY.change}</Link>
            </Button>
            <Button variant="link" onClick={() => setHeld(true)}>
              {MESSAGE_COPY.skip}
            </Button>
          </span>
        ) : undefined
      }
      reassurance={draft ? MESSAGE_COPY.reassurance : undefined}
    >
      {errors.length > 0 ? (
        <p role="alert" data-reasons={errors.join(" ")} className="m-0 text-body text-ink">
          {MESSAGE_COPY.stopped}. {MESSAGE_COPY.stoppedDetail} {MESSAGE_COPY.tryLater}
        </p>
      ) : null}
      {!draft && errors.length === 0 ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">{MESSAGE_COPY.loading}</span>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}
      {draft ? (
        <>
          <dl className="m-0 grid gap-1 text-body">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-2">{call ? MESSAGE_COPY.calling : MESSAGE_COPY.to}:</dt>
              <dd className="m-0 min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{action.name ?? draft.address}</dd>
            </div>
            {draft.channel === "email" && draft.subject ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-ink-2">{MESSAGE_COPY.subject}:</dt>
                <dd className="m-0 min-w-0 text-ink [overflow-wrap:anywhere]">{draft.subject}</dd>
              </div>
            ) : null}
          </dl>
          <Surface variant="well" radius="md" padding="md" className="max-h-[28rem] overflow-y-auto" tabIndex={0} aria-label="The message">
            <p className="m-0 whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">{draft.body}</p>
          </Surface>
          <div className="grid gap-2">
            <h3 className="m-0 text-body font-semibold text-ink">{MESSAGE_COPY.whatTheySee}</h3>
            {shared.length === 0 ? (
              <p className="m-0 text-body text-ink-2">{MESSAGE_COPY.nothingShared}</p>
            ) : (
              <ul className="m-0 grid list-disc gap-1 pl-6 text-body text-ink">
                {shared.map(({ key, value }) => (
                  <li key={key} className="[overflow-wrap:anywhere]">
                    {shareLabel(key)}
                    {value ? <span className="text-ink-2">: {value}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!disclosed ? (
            <p role="alert" className="m-0 text-body text-warn-ink">
              {MESSAGE_COPY.noDisclosure}
            </p>
          ) : null}
        </>
      ) : null}
    </ActionCard>
  );
}
