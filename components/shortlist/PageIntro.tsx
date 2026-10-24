import type { ReactNode } from "react";

/**
 * Title block for the results pages. The case layout supplies the shell, header and <main>,
 * so these pages render content only and carry their own h1.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-col gap-5 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
      <div className="grid max-w-3xl gap-3">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">
          {eyebrow}
        </p>
        <h2 className="m-0 max-w-none font-display text-h2 font-light text-ink display-soft text-balance">
          {title}
        </h2>
        <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
          {lede}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>
      ) : null}
    </header>
  );
}
