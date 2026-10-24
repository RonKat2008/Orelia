import type { PacketSection } from './types';
import { includedSections } from './model';
import { SourceLink } from './shared';

/** Renders only sections the patient ticked. Shared by the builder preview, the print page and the doctor review. */
export function PacketSections({ sections }: { sections: readonly PacketSection[] }) {
  return (
    <div className="grid gap-5">
      {includedSections(sections).map(s => (
        <section key={s.key} aria-label={s.title} className="grid gap-1.5">
          <h5 className="m-0 text-body font-semibold text-ink">{s.title}</h5>
          {s.items.length === 0 ? (
            <p className="m-0 text-small text-ink-3">Nothing to show here.</p>
          ) : (
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-body text-ink">
              {s.items.map((item, i) => (
                <li key={`${i}-${item.text}`} className="text-pretty break-words">
                  {item.date ? <span className="font-semibold tabular-nums">{item.date}: </span> : null}
                  {item.text}
                  {item.sourceUrl ? <> <SourceLink url={item.sourceUrl} className="print:hidden" /></> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
