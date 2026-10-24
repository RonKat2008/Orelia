import { cn } from "@/lib/ui/cn";

export type EvidenceLevel = "strong" | "moderate" | "limited" | "unverified";

const LEVELS: Record<EvidenceLevel, { bars: number; label: string; tone: string; hint: string }> = {
  strong: { bars: 3, label: "Strong evidence", tone: "text-ok", hint: "Confirmed by several independent sources" },
  moderate: { bars: 2, label: "Moderate evidence", tone: "text-teal", hint: "Confirmed by one reliable source" },
  limited: { bars: 1, label: "Limited evidence", tone: "text-warn-ink", hint: "Mentioned, not yet confirmed" },
  unverified: { bars: 0, label: "Not verified", tone: "text-ink-3", hint: "We could not confirm this yet" },
};

export interface EvidenceBadgeProps {
  level: EvidenceLevel;
  /** Number of sources backing the claim, shown after the label. */
  sources?: number;
  /** Show the explanatory hint under the label. */
  showHint?: boolean;
  className?: string;
}

/**
 * EvidenceBadge: how well-supported a claim is. Three bars (a filled count, like a
 * signal meter) plus a written level, so meaning never depends on colour.
 */
export function EvidenceBadge({ level, sources, showHint = false, className }: EvidenceBadgeProps) {
  const meta = LEVELS[level];
  return (
    <span
      data-slot="evidence-badge"
      data-level={level}
      className={cn("inline-flex items-start gap-2 text-small", className)}
    >
      <span aria-hidden className={cn("mt-[0.2em] flex h-3.5 items-end gap-[3px]", meta.tone)}>
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-[4px] rounded-[1px]",
              bar === 1 ? "h-[6px]" : bar === 2 ? "h-[10px]" : "h-[14px]",
              bar <= meta.bars ? "bg-current" : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className="flex flex-col">
        <span className={cn("font-semibold leading-tight", meta.tone)}>
          {meta.label}
          {typeof sources === "number" ? (
            <span className="font-normal text-ink-2">
              {" "}
              · {sources} {sources === 1 ? "source" : "sources"}
            </span>
          ) : null}
        </span>
        {showHint ? <span className="text-micro text-ink-3 normal-case tracking-normal">{meta.hint}</span> : null}
      </span>
    </span>
  );
}
