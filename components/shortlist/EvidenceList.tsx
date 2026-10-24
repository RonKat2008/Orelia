import type { Evidence } from "@/lib/contracts";
import { SourceChip } from "@/components/ui";

/**
 * Every item here came from a tool wrapper and passed the verifier, which drops
 * anything without a source link. That is what "Verified" on the chip states.
 */
export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) {
    return (
      <p className="m-0 text-small text-ink-3">
        No source links were attached to this result.
      </p>
    );
  }
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {items.map((item) => (
        <li
          key={`${item.sourceUrl}|${item.claim}`}
          id={item.id ? `evidence-${item.id}` : undefined}
          className="grid min-w-0 gap-1.5 rounded-md bg-paper-2/70 p-3 shadow-inset"
        >
          <p className="m-0 text-small text-ink text-pretty">{item.claim}</p>
          <SourceChip
            url={item.sourceUrl}
            verified
            date={item.fetchedAt}
            title={item.claimType.replaceAll("_", " ")}
          />
        </li>
      ))}
    </ul>
  );
}
