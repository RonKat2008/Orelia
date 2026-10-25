import { Info } from "lucide-react";

/**
 * Persistent safety notice. Sits above every page and never animates.
 * Name and (empty) props are stable: pages import it as-is.
 */
export function SafetyBanner() {
  return (
    <aside
      role="note"
      aria-label="Safety notice"
      data-slot="safety-banner"
      className="relative border-b border-gold/60 bg-gold-soft text-ink"
    >
      <p className="page-container m-0 flex items-start gap-2.5 py-2.5 text-small leading-snug sm:items-center">
        <Info aria-hidden className="mt-px size-4 shrink-0 text-warn-ink sm:mt-0" strokeWidth={2.25} />
        <span data-sb="long">
          <strong className="font-semibold">Orelia never gives medical advice.</strong> If symptoms are urgent,
          contact your care team or call 911.
        </span>
        <span data-sb="short" hidden>
          <strong className="font-semibold">No medical advice.</strong> Urgent? Call your care team or 911.
        </span>
      </p>
    </aside>
  );
}
