import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Deprecated: use PageHeader from "@/components/ui" (docs/DESIGN-v2.md 6). Kept as a thin wrapper so existing pages
 * keep working; the eyebrow shows in judge view only.
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
  return <PageHeader eyebrow={eyebrow} title={title} lede={lede} action={actions} />;
}
