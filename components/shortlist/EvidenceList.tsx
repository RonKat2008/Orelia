import type { Evidence } from "@/lib/contracts";
import { formatSourceDate, parseSource } from "@/lib/ui/format";

/**
 * Every item here came from a tool wrapper and passed the verifier, which drops anything without a source link.
 * v2: plain rows (claim, then the source domain as a link), no chip per source (docs/DESIGN-v2.md 4.5).
 */
export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) {
    return <p className="m-0 text-small text-ink-2">No source links were attached to this result.</p>;
  }
  return (
    <ul className="m-0 grid list-none gap-0 border-t border-line p-0">
      {items.map((item) => {
        const source = parseSource(item.sourceUrl);
        const date = formatSourceDate(item.fetchedAt);
        return (
          <li
            key={`${item.sourceUrl}|${item.claim}`}
            id={item.id ? `evidence-${item.id}` : undefined}
            className="grid min-w-0 gap-1 border-b border-line py-3"
          >
            <p className="m-0 break-words text-small text-ink text-pretty">{item.claim}</p>
            <p className="m-0 text-small text-ink-2">
              {source.href ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring"
                >
                  {source.domain}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="break-all">{source.domain}</span>
              )}
              {date ? <span> · {date}</span> : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
