import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";

export type OutreachSlug = "consent" | "plan" | "coordinate" | "outbox" | "tracker" | "threads" | "appointments";

/**
 * Deprecated frame for the outreach screens. The 7-pill stage row is gone: the judge StageBar in the case shell is
 * the one navigation system now (docs/DESIGN-v2.md 5.3). This thin wrapper keeps call sites working and renders a
 * PageHeader (the page's h1; the eyebrow shows in judge view only). New code: use PageHeader directly.
 */
export function OutreachNav({
  eyebrow,
  title,
  lede,
  children,
}: {
  caseId: string;
  current: OutreachSlug;
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ds-root grid grid-cols-[minmax(0,1fr)] gap-8" aria-labelledby="outreach-title">
      <PageHeader eyebrow={eyebrow} title={title} lede={lede} titleId="outreach-title" className="mb-0" />
      {children}
    </section>
  );
}
