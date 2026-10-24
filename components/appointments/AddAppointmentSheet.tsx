"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, toast } from "@/components/ui";
import { APPOINTMENT_KINDS, KIND_LABELS, type AppointmentKind } from "@/lib/appointments/schema";
import { wallTimeToUtc } from "@/lib/appointments/timezone";
import { createAppointment } from "./client";
import type { ApptView } from "./model";

const ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ZONES.some(([z]) => z === zone) ? zone : "America/New_York";
}

/** Add an appointment the patient booked themselves (phone call, portal). It is confirmed by definition. */
export function AddAppointmentSheet({ caseId, onCreated }: { caseId: string; onCreated: (a: ApptView) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AppointmentKind>("appointment");
  const [zone, setZone] = useState(browserZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const minutes = Number(form.get("duration") ?? 60);
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return setError("Add a date and a time.");
    const start = wallTimeToUtc({ year: y, month: m, day: d, hour: hh, minute: mm }, zone);
    const text = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    setBusy(true);
    setError(null);
    const result = await createAppointment(caseId, {
      kind, title: text("title") ?? `${KIND_LABELS[kind]}`, startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + Math.max(15, minutes) * 60000).toISOString(), timezone: zone,
      location: text("location"), telehealthUrl: text("telehealthUrl"), phone: text("phone"), withWhom: text("withWhom"),
    });
    setBusy(false);
    if (!result.ok) return setError(result.reasons.includes("invalid_request") ? "Check the fields: video links must start with https://." : "Could not save. Try again in a moment.");
    onCreated(result.data.appointment);
    setOpen(false);
    toast.success("Appointment added", { description: "Reminders are set for a day and two hours before." });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Add an appointment"
      description="One you booked yourself. Nothing is sent to anyone."
      trigger={<Button variant="secondary"><Plus aria-hidden /> Add an appointment</Button>}
    >
      <form className="grid gap-5 pb-6" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="What is it?" htmlFor="appt-kind">
          <Select value={kind} onValueChange={(v) => setKind(v as AppointmentKind)}>
            <SelectTrigger id="appt-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {APPOINTMENT_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Title" htmlFor="appt-title" hint="Shown on your calendar. Leave health details out.">
          <Input id="appt-title" name="title" maxLength={160} placeholder="Consult with Dr. Rivera" />
        </Field>
        <Field label="With" htmlFor="appt-with" optional>
          <Input id="appt-with" name="withWhom" maxLength={160} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="appt-date"><Input id="appt-date" name="date" type="date" required /></Field>
          <Field label="Time" htmlFor="appt-time"><Input id="appt-time" name="time" type="time" required /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="appt-zone">
            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger id="appt-zone"><SelectValue /></SelectTrigger>
              <SelectContent>{ZONES.map(([z, label]) => <SelectItem key={z} value={z}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Length (minutes)" htmlFor="appt-duration"><Input id="appt-duration" name="duration" type="number" min={15} max={480} step={15} defaultValue={60} /></Field>
        </div>
        <Field label="Address" htmlFor="appt-location" optional><Input id="appt-location" name="location" maxLength={300} /></Field>
        <Field label="Video visit link" htmlFor="appt-url" optional hint="https:// links only."><Input id="appt-url" name="telehealthUrl" type="url" maxLength={500} /></Field>
        <Field label="Office phone" htmlFor="appt-phone" optional><Input id="appt-phone" name="phone" type="tel" maxLength={40} /></Field>
        {error ? <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft p-3 text-small text-ink">{error}</p> : null}
        <Button type="submit" loading={busy} loadingText="Saving">Save appointment</Button>
      </form>
    </Sheet>
  );
}
