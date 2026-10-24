import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui/cn";

/**
 * Badge: a short, *dynamic* status ("Your turn", "Replied", "Needs you", "Couldn't reach"). Tone carries meaning,
 * so always pair it with words; never rely on the colour alone.
 *
 * v2 budget (docs/DESIGN-v2.md 4.5): at most 1 badge per row or card in patient view, 2 in judge view. Static facts
 * ("Email", "Clinic") are plain text, not badges. Patient view uses only PATIENT_BADGE_TONES.
 */
export const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border",
    "font-sans font-semibold leading-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  ],
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-paper-2 text-ink-2",
        teal: "border-teal/25 bg-teal-soft text-teal-ink dark:text-teal",
        sage: "border-sage/60 bg-sage-soft text-ink",
        gold: "border-gold/70 bg-gold-soft text-ink",
        accent: "border-terracotta/45 bg-terracotta-soft text-ink",
        email: "border-ch-email/30 bg-ch-email-soft text-ch-email",
        call: "border-ch-call/30 bg-ch-call-soft text-ch-call",
        apply: "border-ch-apply/30 bg-ch-apply-soft text-ch-apply",
        paper: "border-src-paper/30 bg-paper-2 text-src-paper",
        trial: "border-src-trial/30 bg-paper-2 text-src-trial",
        center: "border-src-center/30 bg-paper-2 text-src-center",
        aid: "border-src-aid/30 bg-paper-2 text-src-aid",
        ok: "border-ok/30 bg-ok-soft text-ok",
        warn: "border-warn/35 bg-warn-soft text-warn-ink",
        danger: "border-danger/30 bg-danger-soft text-danger",
        outline: "border-line-strong bg-transparent text-ink-2",
      },
      size: {
        // 14 px text: badges reuse the `small` step instead of adding a 12 px size to the view.
        sm: "h-6 px-2.5 text-small",
        md: "h-7 px-3 text-small",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

/** The only tones allowed on patient screens (teal = your turn / working; ok, warn, danger = status). */
export const PATIENT_BADGE_TONES = ["teal", "ok", "warn", "danger"] as const;
export type PatientBadgeTone = (typeof PATIENT_BADGE_TONES)[number];

/** Max badges per row or card for each view. */
export const BADGE_BUDGET = { patient: 1, judge: 2 } as const;

export type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Leading dot in the tone colour (decorative; the text still carries meaning). */
    dot?: boolean;
  };

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" data-tone={tone ?? "neutral"} className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-pill bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}
