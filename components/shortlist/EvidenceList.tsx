import type { Evidence } from "@/lib/contracts";

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) {
    return <p className="meta">No source links were attached to this result.</p>;
  }
  return (
    <ul className="evidence">
      {items.map((item) => (
        <li key={item.sourceUrl + item.claim}>
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            {item.claim}
          </a>
          <p className="meta">
            {item.sourceKind} · {item.claimType}
          </p>
        </li>
      ))}
    </ul>
  );
}
