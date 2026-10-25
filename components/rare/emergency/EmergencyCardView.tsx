"use client";

import { Printer, Smartphone } from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import { ContactsEditor } from "./ContactsEditor";
import { EmergencySheet } from "./EmergencySheet";
import { buildSheetModel, renderSheetHtml } from "./model";
import { useEmergencyCard } from "./useEmergencyCard";

export const EMERGENCY_COPY = {
  loading: "Loading your card",
  failed: "We couldn't load your card just now. Please try again in a moment.",
  contactsTitle: "Who should staff call?",
  contactsLede: "Add up to 4 people. They show on your card.",
  reviewTitle: "Check your card",
  reviewLede: "Read every line. If it is right, save it. Then you can print it or keep a copy on your phone.",
  approve: "This is right, save my card",
  approved: "Saved. Your card is ready to print or keep.",
  changed: "Your card changed since you saved it. Please check it again.",
  empty: "Add a contact or a record first. There is nothing to put on the card yet.",
  print: "Print",
  save: "Save to phone",
  saveNote: "Then add it to your phone's Files or Wallet notes. A screenshot of the card works too.",
  storage: "We couldn't keep your approval on this device. Check that your browser allows saving, then save again.",
  deviceNote: "Your approval is kept on this device only.",
  left: (n: number) => (n === 1 ? "We left out 1 line that read like advice or had no source." : `We left out ${n} lines that read like advice or had no source.`),
} as const;

function downloadHtml(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "emergency-card.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EmergencyCardView({ caseId }: { caseId: string }) {
  const card = useEmergencyCard(caseId);

  if (card.load.kind === "loading") {
    return (
      <div aria-busy="true" className="grid gap-3">
        <span className="sr-only">{EMERGENCY_COPY.loading}</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (card.load.kind === "error" || !card.content) {
    return <p role="status" className="m-0 text-body text-ink-2">{EMERGENCY_COPY.failed}</p>;
  }

  const approved = card.state === "approved" && card.snapshot !== null;
  const shown = card.snapshot?.content ?? card.content;
  const model = buildSheetModel(shown, card.load.data.condition, card.snapshot?.approvedAt ?? null);
  const canApprove = card.ready && !card.empty && !approved;

  return (
    <div className="grid gap-5">
      <section aria-labelledby="ec-contacts" className="grid gap-2">
        <h2 id="ec-contacts" className="m-0 text-h4 font-semibold text-ink">{EMERGENCY_COPY.contactsTitle}</h2>
        <p className="m-0 text-small text-ink-2">{EMERGENCY_COPY.contactsLede}</p>
        <ContactsEditor key={card.record.version} initial={card.record.inputs.contacts} onSave={card.setContacts} />
      </section>

      <section aria-labelledby="ec-review" className="grid max-w-prose gap-2">
        <h2 id="ec-review" className="m-0 text-h4 font-semibold text-ink">{EMERGENCY_COPY.reviewTitle}</h2>
        <p className="m-0 text-small text-ink-2">{EMERGENCY_COPY.reviewLede}</p>
        <EmergencySheet model={model} approved={approved} />
        {card.dropped.length > 0 ? <p className="m-0 text-small text-ink-2">{EMERGENCY_COPY.left(card.dropped.length)}</p> : null}
        <p role="status" className="m-0 text-small font-semibold text-ink">
          {approved ? EMERGENCY_COPY.approved : card.state === "changed" ? EMERGENCY_COPY.changed : card.empty ? EMERGENCY_COPY.empty : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={card.approve} disabled={!canApprove}>{EMERGENCY_COPY.approve}</Button>
          <Button variant="secondary" disabled={!approved} onClick={() => window.print()}>
            <Printer aria-hidden />
            {EMERGENCY_COPY.print}
          </Button>
          <Button variant="secondary" disabled={!approved} onClick={() => downloadHtml(renderSheetHtml(model))}>
            <Smartphone aria-hidden />
            {EMERGENCY_COPY.save}
          </Button>
        </div>
        {approved ? <p className="m-0 text-small text-ink-2">{EMERGENCY_COPY.saveNote}</p> : null}
        <p className="m-0 text-micro text-ink-3">{EMERGENCY_COPY.deviceNote}</p>
        {card.saveFailed ? <p role="alert" className="m-0 text-small font-semibold text-danger">{EMERGENCY_COPY.storage}</p> : null}
      </section>
    </div>
  );
}
