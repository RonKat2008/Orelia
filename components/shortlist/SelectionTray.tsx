"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { Button, IconButton, Sheet } from "@/components/ui";
import type { ShortlistCard } from "./data";
import { selectionKey } from "./data";
import { eyebrowOf, titleOf } from "./view-model";

/**
 * Judge selection tray (docs/DESIGN-v2.md 5.3): sticky bottom bar with the count, a quiet "Review choices" link and
 * the view's one primary, "Continue to consent". Page content reserves pb-28 so focus is never hidden under it.
 */
export function SelectionTray({
  caseId,
  chosen,
  limit,
  onRemove,
}: {
  caseId: string;
  chosen: ShortlistCard[];
  limit: number;
  onRemove: (id: string) => void;
}) {
  const count = chosen.length;
  const consentHref = `/cases/${caseId}/consent`;
  return (
    <div
      data-slot="selection-tray"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="page-container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2.5 sm:py-3">
        <p className="m-0 text-body text-ink" role="status" aria-live="polite">
          <span className="font-semibold tabular-nums">{count}</span>
          <span className="text-ink-2"> of {limit} chosen</span>
        </p>
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
          <Sheet
            title="Your contact list"
            description={`Up to ${limit}. Nothing is sent without your OK.`}
            trigger={
              <Button variant="link" size="sm" disabled={count === 0}>
                Review choices
              </Button>
            }
          >
            <ul className="m-0 grid list-none border-t border-line p-0">
              {chosen.map((card) => (
                <li key={selectionKey(card)} className="flex min-h-14 items-center gap-3 border-b border-line py-2">
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-semibold text-ink">{titleOf(card.resource)}</span>
                    <span className="truncate text-small text-ink-2">{eyebrowOf(card.resource, card.evidence)}</span>
                  </div>
                  <IconButton label={`Remove ${titleOf(card.resource)}`} onClick={() => onRemove(selectionKey(card))}>
                    <X aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          </Sheet>
          {count > 0 ? (
            <Button asChild className="px-5">
              <Link href={consentHref}>
                Continue to consent <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button disabled className="px-5">
              Continue to consent
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
