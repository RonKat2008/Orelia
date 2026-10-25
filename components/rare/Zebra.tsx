import type { CSSProperties } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The zebra stripe is the international rare-disease symbol. Orelia uses it in exactly TWO places: the landing
 * page mark beside the eyebrow and the "Your condition" card. Both are decorative (aria-hidden), low contrast (the
 * ink token at a few percent, so it follows light and dark themes), take no layout space of their own and never move.
 */
const STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--ink) var(--zebra-strength, 9%), transparent) 0 2px, transparent 2px 7px)",
};

/** A fine stripe texture that fills its (relatively positioned) parent. */
export function ZebraTexture({ className, strength }: { className?: string; strength?: number }) {
  return (
    <span
      aria-hidden="true"
      data-zebra="texture"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ ...STRIPES, ...(strength ? ({ "--zebra-strength": `${strength}%` } as CSSProperties) : {}) }}
    />
  );
}

/** A small inline mark (fixed 14 x 14 px box, so it never shifts text). */
export function ZebraMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-zebra="mark"
      className={cn("inline-block size-3.5 shrink-0 rounded-[3px] align-[-2px] ring-1 ring-inset ring-line", className)}
      style={{ ...STRIPES, ["--zebra-strength" as string]: "34%" }}
    />
  );
}
