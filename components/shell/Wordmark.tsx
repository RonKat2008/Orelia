import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/** The Wayfinder wordmark: the serif (Newsreader) with a waypoint mark (a path reaching a point). */
/** `compact` hides the word (kept for screen readers) on very narrow screens, where the header also holds the view switch. */
export function Wordmark({ className, href = "/", compact = false }: { className?: string; href?: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      data-slot="wordmark"
      className={cn(
        "group/wordmark inline-flex items-center gap-2.5 rounded-sm text-ink no-underline focus-ring",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 28 28" className="size-7 shrink-0">
        <circle cx="14" cy="14" r="13" className="fill-teal" />
        <path
          d="M7.5 19.5c2.6-.2 3.6-2.4 5-5.1s2.6-5 6-5.2"
          className="fill-none stroke-on-teal"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="2.2 2.6"
        />
        <circle cx="19.4" cy="9.2" r="2.4" className="fill-gold transition-transform duration-300 ease-out-expo group-hover/wordmark:scale-110 motion-reduce:transition-none" style={{ transformOrigin: "19.4px 9.2px" }} />
      </svg>
      <span className={cn("font-display text-[1.45rem] font-medium leading-none tracking-[-0.015em] display-soft", compact && "max-[29.99rem]:sr-only")}>
        Wayfinder
      </span>
    </Link>
  );
}
