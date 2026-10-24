import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { BadgeView } from "./verify-model";

/** Phone-verified answers. Each links to the threads page, where the call record lives; the callee's quote is the tooltip. */
export function VerifiedBadges({ caseId, badges }: { caseId: string; badges: BadgeView[] }) {
  if (badges.length === 0) return null;
  return (
    <ul aria-label="Verified by phone" className="m-0 grid list-none gap-2 p-0">
      {badges.map((badge) => (
        <li key={badge.id}>
          <Link
            href={`/cases/${caseId}/threads`}
            title={badge.quote ? `They said: “${badge.quote}”` : "See the call record"}
            className="inline-flex min-h-8 max-w-full items-start gap-1.5 rounded-md border border-ok/30 bg-ok-soft px-2.5 py-1.5 text-small font-semibold text-ok no-underline hover:underline focus-ring"
          >
            <BadgeCheck aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 text-pretty">{badge.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
