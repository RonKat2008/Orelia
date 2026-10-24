import type { CSSProperties, ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleDashed, Globe, ListTodo, Mail, Phone, Reply } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SourceChip } from "@/components/ui/source-chip";
import { cn } from "@/lib/ui/cn";
import { ChannelCombo } from "./channels";
import { PLAN_EXAMPLES } from "./content";

/**
 * Small product vignettes for the five-scene "How it works" story. Each is an
 * illustration (labelled "Example") with synthetic data, not a real result. Sample
 * chips are scheme-less, so they render as text rather than links.
 *
 * Scene entrance: items start "pending" only once the choreography marks a scene
 * `data-played="false"` (JS loaded, motion allowed), then settle when it plays.
 * Without JS, or under reduced motion, the attribute is never set: the final state shows.
 */

const enter =
  "transition-[opacity,transform] duration-700 ease-out-expo motion-reduce:transition-none group-data-[played=false]/scene:translate-y-2 group-data-[played=false]/scene:opacity-0";
const swap = "transition-opacity duration-500 motion-reduce:transition-none";

function delay(i: number, base: number, step: number): CSSProperties {
  return { transitionDelay: `${base + i * step}ms` };
}

function Frame({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative rounded-lg border border-line/80 bg-card shadow-lg", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="text-small font-semibold text-ink">{label}</span>
        <Badge tone="outline">Example</Badge>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Row({ label, value, ticked, index }: { label: string; value: string; ticked: boolean; index: number }) {
  return (
    <li className={cn(enter, "flex items-center gap-3 border-b border-line py-2.5 last:border-b-0")} style={delay(index, 100, 220)}>
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-sm border",
          ticked ? "border-teal bg-teal text-on-teal" : "border-line-strong bg-card",
        )}
      >
        {ticked ? <CheckCircle2 className="size-3.5" strokeWidth={2.5} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-micro font-semibold uppercase text-ink-3">{label}</span>
        <span className="block truncate text-small text-ink">{value}</span>
      </span>
      <span className="text-micro font-semibold text-ink-3">{ticked ? "Confirmed" : "Check"}</span>
    </li>
  );
}

export function DetailsVignette() {
  return (
    <Frame label="Confirm your details">
      <ul className="m-0 list-none p-0">
        <Row index={0} label="Diagnosis, as written" value="Vascular Ehlers-Danlos syndrome" ticked />
        <Row index={1} label="Where you live" value="Columbus, Ohio" ticked />
        <Row index={2} label="What you are looking for" value="A specialist who sees adults" ticked />
        <Row index={3} label="Travel" value="Up to 3 hours by car" ticked={false} />
      </ul>
    </Frame>
  );
}

const AGENTS = ["Literature", "Trials", "Centers", "Advocacy", "Aid", "Logistics", "Contacts"] as const;

export function SwarmVignette() {
  return (
    <Frame label="Research agents">
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {AGENTS.map((agent, i) => {
          const isDone = i < 4;
          return (
            <li
              key={agent}
              className={cn(
                enter,
                "flex items-center gap-2 rounded-md border px-3 py-2.5 text-small",
                isDone ? "border-ok/25 bg-ok-soft/60" : "border-teal/25 bg-teal-soft/60",
              )}
              style={delay(i, 80, 120)}
            >
              {isDone ? (
                <CheckCircle2 aria-hidden className="size-4 text-ok" />
              ) : (
                <CircleDashed aria-hidden className="size-4 text-teal" />
              )}
              <span className="font-semibold text-ink">{agent}</span>
              <span className="sr-only">{isDone ? "done" : "searching"}</span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 mt-4 text-small text-ink-2">
        Each agent searches on its own, at the same time as the others, and records where it found each fact.
      </p>
    </Frame>
  );
}

const CLAIMS = [
  { text: "Runs a connective-tissue clinic that sees adults.", source: "npiregistry.cms.hhs.gov" },
  { text: "Has published on vascular EDS in adults.", source: "pubmed.ncbi.nlm.nih.gov" },
  { text: "Study is recruiting, with a site in Ohio.", source: "clinicaltrials.gov" },
] as const;

export function ValidateVignette() {
  return (
    <Frame label="Checking every claim">
      <ul className="m-0 grid list-none gap-3 p-0">
        {CLAIMS.map((claim, i) => (
          <li key={claim.text} className="grid justify-items-start gap-2 border-b border-line pb-3">
            <div className="flex w-full items-start justify-between gap-3">
              <p className="m-0 text-small text-ink">{claim.text}</p>
              <span className="grid shrink-0 justify-items-end">
                <span
                  aria-hidden
                  className={cn(
                    swap,
                    "col-start-1 row-start-1 inline-flex items-center gap-1.5 text-micro font-semibold uppercase text-ink-3 opacity-0 group-data-[played=false]/scene:opacity-100",
                  )}
                  style={delay(i, 300, 520)}
                >
                  <CircleDashed className="size-3.5" />
                  Checking
                </span>
                <span
                  className={cn(
                    swap,
                    "col-start-1 row-start-1 inline-flex items-center gap-1.5 text-micro font-semibold uppercase text-ok group-data-[played=false]/scene:opacity-0",
                  )}
                  style={delay(i, 300, 520)}
                >
                  <CheckCircle2 aria-hidden className="size-3.5" />
                  Sourced
                </span>
              </span>
            </div>
            <div className={enter} style={delay(i, 420, 520)}>
              <SourceChip url={claim.source} verified />
            </div>
          </li>
        ))}
        <li
          className={cn(
            enter,
            "flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-small text-ink-3",
          )}
          style={delay(3, 420, 520)}
        >
          <CircleDashed aria-hidden className="size-4" />
          One claim had no source, so it was dropped.
        </li>
      </ul>
    </Frame>
  );
}

export function PlanVignette() {
  return (
    <Frame label="Contact plan, one per resource">
      <ul className="m-0 grid list-none gap-0 p-0">
        {PLAN_EXAMPLES.map((plan, i) => (
          <li
            key={plan.name}
            className="grid gap-2 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4"
          >
            <span className="min-w-0">
              <span className="block text-micro font-semibold uppercase text-ink-3">{plan.kind}</span>
              <span className="block truncate text-small font-semibold text-ink">{plan.name}</span>
              <span className="block text-small text-ink-2">{plan.why}</span>
            </span>
            <span className={enter} style={delay(i, 250, 300)}>
              <ChannelCombo channels={plan.channels} />
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const THREAD = [
  { icon: CheckCircle2, when: "Mon 9:02", text: "You approved 2 emails, 1 call and 1 form", tone: "teal" },
  { icon: Mail, when: "Mon 9:03", text: "Email sent to the clinic's intake team", tone: "neutral" },
  { icon: Globe, when: "Mon 9:10", text: "Study screening form submitted, confirmation saved", tone: "neutral" },
  { icon: Phone, when: "Mon 10:30", text: "Called the intake line, transcript saved", tone: "neutral" },
  { icon: Reply, when: "Wed", text: "Reply read: the clinic asks for a referral letter", tone: "neutral" },
  { icon: ListTodo, when: "Wed", text: "Task for you: ask your doctor for the letter", tone: "gold" },
  { icon: CalendarClock, when: "Thu", text: "Day-3 follow-up sent to the foundation, as you pre-approved", tone: "ok" },
] as const;

const THREAD_TONES = {
  teal: "border-teal/30 bg-teal-soft text-teal",
  neutral: "border-line-strong bg-card text-ink-2",
  gold: "border-gold/60 bg-gold-soft text-ink",
  ok: "border-ok/30 bg-ok-soft text-ok",
} as const;

export function ReachVignette() {
  return (
    <Frame label="Connection tracker">
      <ol className="m-0 grid list-none gap-0 p-0">
        {THREAD.map((item, i) => (
          <li key={item.text} className={cn(enter, "relative flex gap-3 pb-3 last:pb-0")} style={delay(i, 150, 330)}>
            <span
              aria-hidden
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-pill border",
                THREAD_TONES[item.tone],
              )}
            >
              <item.icon className="size-3.5" />
            </span>
            <span className="grid gap-0.5 pt-0.5">
              <span className="text-micro font-semibold uppercase text-ink-3">{item.when}</span>
              <span className={cn("text-small text-ink", item.tone === "gold" && "font-semibold")}>{item.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export const VIGNETTES: Record<string, () => ReactNode> = {
  details: DetailsVignette,
  swarm: SwarmVignette,
  validate: ValidateVignette,
  plan: PlanVignette,
  reach: ReachVignette,
};
