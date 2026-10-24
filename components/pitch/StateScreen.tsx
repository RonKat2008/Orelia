import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** A path that reaches toward a waypoint. `broken` leaves a gap in it. */
export function WaypointArt({ variant, className }: { variant: "lost" | "broken" | "waiting"; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 240 120" className={cn("h-auto w-60 max-w-full", className)}>
      <path
        d="M12 98C52 98 62 40 112 54"
        className="fill-none stroke-ink-3"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="3 8"
      />
      <path
        d={variant === "broken" ? "M138 66C170 80 190 40 220 30" : "M140 62C172 70 192 38 220 28"}
        className={cn("fill-none", variant === "waiting" ? "stroke-teal animate-pulse motion-reduce:animate-none" : "stroke-ink-3")}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="3 8"
      />
      <circle cx="12" cy="98" r="7" className="fill-teal" />
      {variant === "lost" ? (
        <text x="126" y="64" textAnchor="middle" className="fill-terracotta font-display text-[28px]">?</text>
      ) : null}
      {variant === "broken" ? (
        <path d="M118 46l16 28M134 46l-16 28" className="stroke-terracotta" strokeWidth="3" strokeLinecap="round" />
      ) : null}
      <circle cx="222" cy="28" r="9" className="fill-gold stroke-gold" strokeWidth="1" />
    </svg>
  );
}

/** Full-width calm message: used by 404, error and loading screens. */
export function StateScreen({
  eyebrow,
  title,
  description,
  art,
  actions,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  art: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grain flex flex-1 items-center border-b border-line bg-paper-2/60", className)}>
      <div className="page-container grid gap-10 py-16 sm:py-24 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid max-w-prose gap-5">
          <p className="m-0 text-small font-semibold text-ink-2">{eyebrow}</p>
          <h1 className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance">{title}</h1>
          <p className="m-0 text-body text-ink-2 text-pretty">{description}</p>
          {actions ? <div className="flex flex-wrap gap-3 pt-2">{actions}</div> : null}
        </div>
        <div className="md:order-last">{art}</div>
      </div>
    </section>
  );
}
