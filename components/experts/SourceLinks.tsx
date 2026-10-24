import { SourceChip } from "@/components/ui";
import type { ExpertTrace } from "@/lib/experts/contract";
import { resolveSources } from "./view-model";

/** Every factual line shows where it came from. Ids that do not resolve are called out, never hidden. */
export function SourceLinks({ trace, ids, label = "Source" }: { trace: Pick<ExpertTrace, "evidence">; ids: readonly string[]; label?: string }) {
  const { links, missing } = resolveSources(trace, ids);
  if (links.length === 0 && missing === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={`${label}s`}>
      {links.map((link) => (
        <SourceChip key={link.id} url={link.url} verified date={link.fetchedAt} title={link.claim} />
      ))}
      {missing > 0 ? <span className="text-micro text-ink-3">Source link unavailable</span> : null}
    </div>
  );
}
