import { CircleDashed, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { formatSourceDate, parseSource } from "@/lib/ui/format";

export interface SourceChipProps {
  /** The page the claim came from. Only http(s) URLs become links. */
  url: string;
  /** Overrides the domain parsed from the URL. */
  domain?: string;
  /** When the source was retrieved or published (ISO string or Date). */
  date?: string | Date | null;
  /** True when Wayfinder confirmed the claim on the page. */
  verified: boolean;
  /** Optional title of the page, used in the accessible name. */
  title?: string;
  className?: string;
}

/**
 * SourceChip: every claim shows where it came from. Verified state is carried by
 * an icon shape (shield vs dashed circle) and a word, not by colour alone.
 * Opens in a new tab and says so to screen readers.
 */
export function SourceChip({ url, domain, date, verified, title, className }: SourceChipProps) {
  const source = parseSource(url);
  const shownDomain = domain ?? source.domain;
  const shownDate = formatSourceDate(date);
  const status = verified ? "Verified" : "Unverified";
  const StatusIcon = verified ? ShieldCheck : CircleDashed;

  const body = (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-1 border-r pr-2 font-semibold",
          verified ? "border-ok/25 text-ok" : "border-line-strong text-ink-2",
        )}
      >
        <StatusIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
        {status}
      </span>
      <span className="truncate font-medium text-ink">{shownDomain}</span>
      {shownDate ? (
        <time
          className="hidden shrink-0 text-ink-3 sm:inline"
          dateTime={date instanceof Date ? date.toISOString() : (date ?? undefined)}
        >
          {shownDate}
        </time>
      ) : null}
      {source.href ? (
        <ExternalLink
          aria-hidden
          className="size-3.5 shrink-0 text-ink-3 transition-transform duration-150 group-hover/source:-translate-y-px group-hover/source:translate-x-px group-hover/source:text-teal motion-reduce:transition-none"
        />
      ) : null}
    </>
  );

  const classes = cn(
    "group/source inline-flex h-7 max-w-full items-center gap-2 rounded-pill border px-2.5 text-micro leading-none",
    verified
      ? "border-ok/30 bg-ok-soft/70"
      : "border-dashed border-line-strong bg-card",
    className,
  );

  const label = [title, shownDomain, shownDate, status].filter(Boolean).join(", ");

  if (!source.href) {
    return (
      <span data-slot="source-chip" data-verified={verified} className={classes} aria-label={label}>
        {body}
      </span>
    );
  }

  return (
    <a
      data-slot="source-chip"
      data-verified={verified}
      href={source.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      className={cn(
        classes,
        "cursor-pointer no-underline focus-ring transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-teal/50 hover:bg-card hover:shadow-sm",
      )}
    >
      {body}
    </a>
  );
}
