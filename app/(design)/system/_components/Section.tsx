import type { ReactNode } from "react";

export function Section({
  id,
  index,
  title,
  intro,
  children,
}: {
  id: string;
  index: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line py-stack first:border-t-0">
      <div className="mb-10 grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10">
        <p className="m-0 font-mono text-mono text-ink-3">{index}</p>
        <div className="grid gap-3">
          <h2 id={`${id}-title`} className="m-0 max-w-none font-display text-h2 font-light text-ink display-soft text-balance">
            {title}
          </h2>
          {intro ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{intro}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="m-0 mb-4 max-w-none font-sans text-micro font-semibold uppercase text-ink-3">{children}</h3>;
}

/** Renders "*word*" segments as the signature Fraunces italic. */
export function Emph({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("*") ? (
          <em key={i} className="emph">
            {part.slice(1, -1)}
          </em>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
