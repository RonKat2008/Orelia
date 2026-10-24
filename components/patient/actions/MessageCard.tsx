"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pencil, Send } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import { DemoCoordinatorBadge } from "@/components/outreach/DemoCoordinators";
import { approveContactDraft, createContactDraft, loadCase, type ApiDraft } from "@/components/outreach/client";
import { fieldValue, type ShareableFieldKey } from "@/components/outreach/fields";
import { LetterSheet, MessageBody } from "@/components/outreach/LetterSheet";
import type { CaseInput } from "@/lib/contracts";
import { hasDisclosure } from "@/lib/safety/disclosure";
import { shareLabel } from "@/lib/patient-status/plain";
import type { PatientNextAction } from "@/lib/patient-status/types";
import type { PatientDraft } from "../usePatientStatus";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

type Shown = { id: string; channel: "email" | "voice"; subject: string | null; body: string; sharedFields: string[]; address: string | null };

function fromApi(draft: ApiDraft): Shown {
  return { id: draft.id, channel: draft.channel, subject: draft.subject ?? null, body: draft.body, sharedFields: draft.sharedFields, address: draft.address };
}

/**
 * Read the exact draft, then Approve / Edit / Not now. Approve is the patient's click; the server sets approved_at
 * and runs the outbound gate. Nothing here approves on its own.
 */
export function MessageCard({
  caseId,
  onDone,
  action,
  headline,
  serverDraft,
}: ActionProps & { action: PatientNextAction; headline: string; serverDraft: PatientDraft | null }) {
  const contactId = action.contactId ?? "";
  const [draft, setDraft] = useState<Shown | null>(
    serverDraft && serverDraft.id === action.draftId ? { ...serverDraft, address: null } : null,
  );
  const [record, setRecord] = useState<CaseInput | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const needsFetch = !draft && !action.draftId;

  useEffect(() => {
    let active = true;
    void loadCase(caseId).then((found) => active && setRecord(found));
    if (needsFetch && contactId) {
      void createContactDraft(contactId).then((result) => {
        if (!active) return;
        if (result.ok) setDraft(fromApi(result.draft));
        else setErrors(result.reasons);
      });
    }
    return () => {
      active = false;
    };
  }, [caseId, contactId, needsFetch]);

  const call = (draft?.channel ?? "email") === "voice";
  const disclosed = draft ? hasDisclosure(draft.body) : false;
  const values = record && draft ? draft.sharedFields.map((key) => fieldValue(record, key as ShareableFieldKey)) : [];

  async function approve() {
    if (!draft || !disclosed) return;
    setBusy(true);
    setErrors([]);
    const result = await approveContactDraft(contactId, draft.id);
    if (!result.ok) {
      setBusy(false);
      setErrors(result.reasons);
      toast.error("The safety check stopped this message", { description: "Nothing was sent." });
      return;
    }
    toast.success(call ? "Call approved" : "Message approved", {
      description: result.sentAt ? "It's on its way. We'll tell you when they reply." : "It will go out shortly.",
    });
    await onDone();
    setBusy(false);
  }

  if (held) {
    return (
      <ActionFrame kind="approve_message" title="OK, it'll wait" lede="Nothing is sent until you approve it." detailsHref={action.detailsHref}>
        <div>
          <Button variant="secondary" size="lg" onClick={() => setHeld(false)}>
            Show the message again
          </Button>
        </div>
      </ActionFrame>
    );
  }

  return (
    <ActionFrame kind="approve_message" title={call ? `Call script for ${action.name ?? "this contact"}` : `Message to ${action.name ?? "this contact"}`} lede={headline} detailsHref={action.detailsHref}>
      {!draft && errors.length === 0 ? (
        action.draftId ? (
          <p className="m-0 text-body text-ink-2">
            This message is waiting in the detailed view.{" "}
            <Link href={action.detailsHref} className="font-semibold text-teal underline underline-offset-4 focus-ring rounded-sm">
              Open it there
            </Link>
            .
          </p>
        ) : (
          <div role="status" aria-busy="true" className="grid gap-3">
            <span className="sr-only">Writing the message</span>
            <Skeleton className="h-48 w-full" />
          </div>
        )
      ) : null}
      {draft ? (
        <>
          <LetterSheet
            channel={draft.channel}
            recipient={action.name ?? draft.address ?? ""}
            subject={draft.channel === "email" ? draft.subject : null}
            label={call ? "Call script, not used yet" : "Email, not sent yet"}
          >
            <MessageBody text={draft.body} sharedValues={values} />
          </LetterSheet>
          {draft.address ? <DemoCoordinatorBadge address={draft.address} /> : null}
          <div className="grid gap-2">
            <p className="m-0 text-small font-semibold text-ink">What this shares</p>
            <p className="m-0 flex flex-wrap gap-2">
              {draft.sharedFields.length === 0 ? (
                <span className="text-small text-ink-2">None of your details. Just the request.</span>
              ) : (
                draft.sharedFields.map((key) => (
                  <Badge key={key} tone="sage" size="md">
                    {shareLabel(key)}
                  </Badge>
                ))
              )}
            </p>
          </div>
          {!disclosed ? (
            <p role="alert" className="m-0 rounded-md border border-warn/40 bg-warn-soft p-4 text-body text-warn-ink">
              This draft is missing the line saying an AI helped, so it can&apos;t be approved.
            </p>
          ) : null}
        </>
      ) : null}
      <ActionError messages={errors} />
      {draft ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" loading={busy} loadingText="Approving" disabled={!disclosed} onClick={() => void approve()}>
            <Send aria-hidden /> {call ? "Approve the call" : "Approve and send"}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={action.detailsHref}>
              <Pencil aria-hidden /> Edit
            </Link>
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setHeld(true)}>
            Not now
          </Button>
        </div>
      ) : null}
    </ActionFrame>
  );
}
