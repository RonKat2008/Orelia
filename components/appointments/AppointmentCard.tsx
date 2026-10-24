"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Download, MapPin, Phone, Video } from "lucide-react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { directionsUrl, googleTemplateUrl, outlookUrl, safeJoinUrl, telLink } from "@/lib/appointments/links";
import { prepItemsFor } from "@/lib/appointments/prep-items";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/appointments/schema";
import { cn } from "@/lib/ui/cn";
import { ChangeRequestDialog } from "./ChangeRequestDialog";
import { countdown, dateBlock, timeRange, type ApptView } from "./model";
import { PrepChecklist } from "./PrepChecklist";
import { useNow } from "./use-now";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;
const LINK = "inline-flex min-h-11 items-center gap-2 rounded-sm text-small font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink focus-ring motion-reduce:transition-none [&_svg]:size-4";

function calendarDetails(a: ApptView): string {
  const items = prepItemsFor(a).map((i) => `- ${i.label}`);
  return ["Bring / prepare:", ...items, ...(a.phone ? [`Office phone: ${a.phone}`] : []), "Added from Wayfinder. Not medical advice."].join("\n");
}

/** A confirmed appointment: date block, countdown, the practical links, prep and change requests. */
export function AppointmentCard({ appointment, featured = false, caseHref, onChange }: { appointment: ApptView; featured?: boolean; caseHref?: string; onChange: (next: ApptView) => void }) {
  const now = useNow();
  const [prepOpen, setPrepOpen] = useState(featured);
  const a = appointment;
  const block = a.startsAt ? dateBlock(a.startsAt, a.timezone) : null;
  const join = safeJoinUrl(a.telehealthUrl);
  const tel = telLink(a.phone);
  const details = calendarDetails(a);
  const google = googleTemplateUrl(a, details);
  const outlook = outlookUrl(a, details);
  const active = a.status === "confirmed";
  const remindedSoon = !!a.remindedAt && active;

  return (
    <article
      aria-labelledby={`appt-${a.id}`}
      data-appointment-status={a.status}
      className={cn("grid gap-4 border-t border-line py-6", featured && "border-t-2 border-teal", !active && "opacity-80")}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-5">
        {block ? (
          <div aria-hidden className={cn("grid min-w-[4.5rem] place-items-center rounded-md bg-paper-2 px-3 py-2 text-center", featured && "bg-teal-soft")}>
            <span className="text-small font-semibold uppercase text-teal-ink">{block.month}</span>
            <span className="font-display text-h3 font-light leading-none text-ink">{block.day}</span>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-2">
          {!active ? (
            <div>
              <Badge tone={a.status === "rescheduled" ? "warn" : "neutral"}>{STATUS_LABELS[a.status]}</Badge>
            </div>
          ) : null}
          <h3 id={`appt-${a.id}`} className="m-0 font-display text-h3 font-normal text-ink display-soft text-balance">
            {a.title}
          </h3>
          <p className="m-0 text-body text-ink-2">
            {block ? <span className="font-semibold text-ink">{block.weekday}, </span> : null}
            {timeRange(a)}
            {active && a.startsAt && now > 0 ? (
              <span className="text-ink-3"> · <span aria-live="off">{countdown(a.startsAt, now)}</span></span>
            ) : null}
          </p>
          <p className="m-0 text-small text-ink-2">
            {[KIND_LABELS[a.kind], a.location, remindedSoon ? "Soon" : null, a.syncedToGoogle ? "On Google Calendar" : null].filter(Boolean).join(" · ")}
          </p>
          {caseHref ? (
            <Link href={caseHref} className="w-fit text-small font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring">
              Open the case
            </Link>
          ) : null}
        </div>
      </div>

      {active ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {join ? (
            <a href={join} {...EXTERNAL} className={LINK}>
              <Video aria-hidden /> Join video visit<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {a.location ? (
            <a href={directionsUrl(a.location)} {...EXTERNAL} className={LINK}>
              <MapPin aria-hidden /> Directions<span className="sr-only"> (Google Maps, opens in a new tab)</span>
            </a>
          ) : null}
          {tel ? (
            <a href={tel} className={LINK}>
              <Phone aria-hidden /> Call the office
            </a>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="link" className="min-h-11 text-small">
                <CalendarPlus aria-hidden /> Add to calendar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="grid w-64 gap-1 p-2">
              <a href={`/api/appointments/${a.id}/ics`} download className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-small font-semibold text-ink no-underline hover:bg-paper-2 focus-ring">
                <Download aria-hidden className="size-4 text-teal" /> Download .ics (Apple, Outlook)
              </a>
              {google ? (
                <a href={google} {...EXTERNAL} className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-small font-semibold text-ink no-underline hover:bg-paper-2 focus-ring">
                  Google Calendar<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
              {outlook ? (
                <a href={outlook} {...EXTERNAL} className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-small font-semibold text-ink no-underline hover:bg-paper-2 focus-ring">
                  Outlook.com<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {active ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="link" className="min-h-11" aria-expanded={prepOpen} aria-controls={`prep-${a.id}`} onClick={() => setPrepOpen((v) => !v)}>
              {prepOpen ? "Hide prep checklist" : "Prep checklist"}
            </Button>
            <ChangeRequestDialog appointment={a} onChange={onChange} />
          </div>
          {prepOpen ? <PrepChecklist id={`prep-${a.id}`} appointment={a} onChange={onChange} /> : null}
        </div>
      ) : null}
    </article>
  );
}
