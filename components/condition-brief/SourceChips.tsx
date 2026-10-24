import type { BriefSource } from "@/lib/condition-brief/contract";
import { cn } from "@/lib/ui/cn";
import { chipAriaLabel, chipText, type SourceIndex } from "./model";

export interface SourceChipsProps {
  sourceIds: readonly string[];
  index: SourceIndex;
  onOpen: (source: BriefSource) => void;
}

/** One numbered button per cited source. Clicking opens the source drawer. */
export function SourceChips({ sourceIds, index, onOpen }: SourceChipsProps) {
  const entries = sourceIds.flatMap((id) => {
    const entry = index.get(id);
    return entry ? [entry] : [];
  });
  if (entries.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Sources">
      {entries.map(({ n, source }) => (
        <li key={source.id}>
          <button
            type="button"
            aria-label={chipAriaLabel(n, source)}
            onClick={() => onOpen(source)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line-strong bg-card px-2.5 text-small font-semibold normal-case tracking-normal text-ink-2",
              "transition-colors duration-150 hover:border-teal/50 hover:bg-teal-soft hover:text-teal-ink focus-ring motion-reduce:transition-none",
            )}
          >
            <span aria-hidden className="grid size-4 place-items-center rounded-pill bg-paper-2 text-small text-ink">
              {n}
            </span>
            <span aria-hidden>{chipText(source)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
