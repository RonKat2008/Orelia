"use client";

import { useState } from "react";
import { CalendarClock, CircleAlert, Quote } from "lucide-react";
import { Badge, Button, ChoiceRow, RadioGroup, RadioGroupItem, toast } from "@/components/ui";
import { KIND_LABELS } from "@/lib/appointments/schema";
import { confirmAppointment, dismissAppointment } from "./client";
import { longDate, reasonText, type ApptView } from "./model";

/**
 * A time an office proposed in a reply. Orelia never confirms it on its own: the patient picks the slot they are
 * keeping (or says "not this one"). Confirming only updates the patient's own record and calendars; it sends nothing.
 */
export function ProposedAppointmentCard({
  appointment,
  onChange,
  primary = true,
}: {
  appointment: ApptView;
  onChange: (next: ApptView) => void;
  /** Only one confirm button per screen is primary; the rest are secondary. */
  primary?: boolean;
}) {
  const [choice, setChoice] = useState("0");
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const slots = appointment.candidates;

  async function run(kind: "confirm" | "dismiss") {
    setBusy(kind);
    setProblem(null);
    const result = kind === "confirm" ? await confirmAppointment(appointment.id, Number(choice)) : await dismissAppointment(appointment.id);
    setBusy(null);
    if (!result.ok) {
      setProblem(reasonText(result.reasons));
      return;
    }
    onChange(result.data.appointment);
    toast.success(kind === "confirm" ? "Appointment confirmed" : "Proposed time dismissed", {
      description: kind === "confirm" ? "It is on your list with reminders. Nothing was sent to the office." : "Nothing was sent to the office.",
    });
  }

  return (
    <article
      aria-labelledby={`proposed-${appointment.id}`}
      data-appointment-status="proposed"
      className="grid gap-5 border-l-2 border-gold pl-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone="warn" dot>Needs you</Badge>
        <span className="text-small text-ink-2">
          {KIND_LABELS[appointment.kind]} · {appointment.source === "call_transcript" ? "From a call" : "From a reply"}
        </span>
      </div>
      <div className="grid gap-1">
        <h3 id={`proposed-${appointment.id}`} className="m-0 font-display text-h3 font-normal text-ink display-soft text-balance">
          {appointment.withWhom ?? "An office"} proposed a time
        </h3>
        <p className="m-0 text-body text-ink-2">Check it against your own schedule, then confirm the one you are keeping.</p>
      </div>
      {appointment.quote ? (
        <blockquote className="m-0 flex gap-3 rounded-md bg-paper-2 p-4 text-body text-ink-2">
          <Quote aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />
          <span className="break-words">
            <span className="sr-only">Their words: </span>
            {appointment.quote}
          </span>
        </blockquote>
      ) : null}
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-2 p-0 text-small font-semibold text-ink">{slots.length > 1 ? "Which time are you keeping?" : "Proposed time"}</legend>
        <RadioGroup value={choice} onValueChange={setChoice} aria-label="Proposed times">
          {slots.map((slot, index) => (
            <ChoiceRow
              key={slot.startsAt}
              title={longDate(slot.startsAt, appointment.timezone)}
              description={slot.weekdayMismatch ? `Their message said "${slot.text}": the weekday and date do not match. Check with the office.` : `Read from "${slot.text}"`}
            >
              <RadioGroupItem value={String(index)} aria-label={longDate(slot.startsAt, appointment.timezone)} />
            </ChoiceRow>
          ))}
        </RadioGroup>
      </fieldset>
      {slots.some((s) => s.weekdayMismatch) ? (
        <p className="m-0 flex items-start gap-2 text-small text-warn-ink">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" /> One time has a weekday that does not match its date.
        </p>
      ) : null}
      {appointment.location ? <p className="m-0 text-small text-ink-2">Where: {appointment.location}</p> : null}
      {problem ? (
        <p role="alert" className="m-0 border-l-2 border-danger pl-3 text-small text-ink">{problem}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={primary ? "primary" : "secondary"} size={primary ? "lg" : "md"} loading={busy === "confirm"} loadingText="Confirming" disabled={busy !== null || slots.length === 0} onClick={() => void run("confirm")}>
          <CalendarClock aria-hidden /> Confirm this time
        </Button>
        <Button variant="link" className="min-h-11" loading={busy === "dismiss"} loadingText="Dismissing" disabled={busy !== null} onClick={() => void run("dismiss")}>
          Not this one
        </Button>
      </div>
      <p className="m-0 text-small text-ink-2">Confirming adds it to your list and calendars. It does not reply to the office.</p>
    </article>
  );
}
