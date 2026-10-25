import type { SheetModel } from "./model";

/**
 * Print rules: only the sheet prints, black on white, one page. The sheet looks the same on screen (paper card)
 * so a screenshot works as a copy.
 */
export const PRINT_CSS = `
@page { margin: 14mm; }
@media print {
  body * { visibility: hidden !important; }
  #emergency-sheet, #emergency-sheet * { visibility: visible !important; }
  #emergency-sheet {
    position: absolute; inset: 0 auto auto 0; width: 100%; max-height: 100vh; overflow: hidden;
    border: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important;
    padding: 0 !important; font-size: 11pt; break-inside: avoid; page-break-inside: avoid;
  }
  #emergency-sheet * { color: #000 !important; background: transparent !important; }
  #emergency-sheet h2 { border-bottom: 1px solid #000; }
}`;

/** The card itself: paper-white in both themes so it reads like the printout. */
export function EmergencySheet({ model, approved }: { model: SheetModel; approved: boolean }) {
  return (
    <article
      id="emergency-sheet"
      aria-label={model.title}
      className="grid gap-2 rounded-lg border-2 border-ink bg-white p-4 text-black"
    >
      <style>{PRINT_CSS}</style>
      <header className="grid gap-0.5">
        <h2 className="m-0 text-h3 font-bold text-black">{model.title}</h2>
        {model.condition ? <p className="m-0 text-body text-black"><strong>Condition:</strong> {model.condition}</p> : null}
      </header>
      {model.sections.map((s) => (
        <section key={s.heading} className="grid gap-0.5">
          <h3 className="m-0 border-b border-black text-small font-bold text-black">{s.heading}</h3>
          <ul className="m-0 grid list-disc gap-0.5 pl-5 text-small text-black">
            {s.lines.map((l) => (
              <li key={`${l.text}-${l.note ?? ""}`}>
                {l.text}
                {l.note ? <span className="block text-micro text-neutral-700">{l.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <footer className="grid gap-0.5 text-micro text-neutral-800">
        <p className="m-0">{model.header}</p>
        <p className="m-0">
          {model.disclaimer}
          {approved && model.approvedOn ? ` Approved ${model.approvedOn}.` : ""}
        </p>
      </footer>
    </article>
  );
}
