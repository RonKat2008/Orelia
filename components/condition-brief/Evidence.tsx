import type { EvidenceLevel } from "@/lib/condition-brief/contract";
import { cn } from "@/lib/ui/cn";
import { LEVEL_LABEL } from "./model";

const BARS = { established: 3, emerging: 2, uncertain: 1 } as const;
const TEXT = { established: "text-ok", emerging: "text-teal-ink dark:text-teal", uncertain: "text-ink-2" } as const;

/**
 * Evidence level as a word plus a three-step bar, never a badge: the words carry the meaning and the bar adds a
 * second, non-colour cue (docs/DESIGN-v2.md 7.12).
 */
export function EvidenceMarker({ level }: { level: EvidenceLevel }) {
  return (
    <span data-level={level} className={cn("inline-flex items-center gap-2 text-small font-semibold", TEXT[level])}>
      <span aria-hidden className="flex h-3.5 items-end gap-[3px]">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-[4px] rounded-[1px]",
              bar === 1 ? "h-[6px]" : bar === 2 ? "h-[10px]" : "h-[14px]",
              bar <= BARS[level] ? "bg-current" : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className="sr-only">Evidence level: </span>
      {LEVEL_LABEL[level]}
    </span>
  );
}
