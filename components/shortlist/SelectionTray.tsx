"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import {
  AvatarInitials,
  Button,
  IconButton,
  Sheet,
  SheetClose,
} from "@/components/ui";
import type { ShortlistCard } from "./data";
import { eyebrowOf, titleOf } from "./view-model";

/**
 * Sticky tray: how many are chosen, a peek at who, and the one primary action.
 * On phones the list opens as a bottom drawer (vaul); on desktop as a side panel.
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur-md"
    >
      <div className="page-container flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-2.5 sm:py-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden -space-x-2 sm:flex" aria-hidden>
            {chosen.slice(0, 5).map((card) => (
              <AvatarInitials
                key={card.resource.id}
                name={titleOf(card.resource)}
                size="sm"
                className="ring-2 ring-paper"
              />
            ))}
          </div>
          <p
            className="m-0 text-body text-ink"
            role="status"
            aria-live="polite"
          >
            <span className="font-display text-h4 tabular-nums">{count}</span>
            <span className="text-ink-2"> of {limit} chosen</span>
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Sheet
            title="Your contact list"
            description={`Up to ${limit}. Nothing is sent until you approve each message.`}
            trigger={
              <Button variant="secondary" size="sm" disabled={count === 0}>
                Review choices
              </Button>
            }
            footer={
              count > 0 ? (
                <SheetClose>
                  <Button asChild>
                    <Link href={consentHref}>
                      Continue to consent <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </SheetClose>
              ) : null
            }
          >
            <ul className="m-0 grid list-none gap-3 p-0">
              {chosen.map((card) => (
                <li
                  key={card.resource.id}
                  className="flex items-center gap-3 rounded-md border border-line bg-paper-2/60 p-3"
                >
                  <AvatarInitials name={titleOf(card.resource)} size="sm" />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-semibold text-ink">
                      {titleOf(card.resource)}
                    </span>
                    <span className="truncate text-small text-ink-3">
                      {eyebrowOf(card.resource)}
                    </span>
                  </div>
                  <IconButton
                    label={`Remove ${titleOf(card.resource)}`}
                    onClick={() => onRemove(card.resource.id)}
                  >
                    <X aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          </Sheet>
          {count > 0 ? (
            <Button asChild className="flex-1 sm:flex-none">
              <Link href={consentHref}>
                Continue to consent <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button disabled className="flex-1 sm:flex-none">
              Continue to consent
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
