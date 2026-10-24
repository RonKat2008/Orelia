"use client";

import { Fragment } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, House, Info, Plus, ShieldCheck, FolderOpen } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/ui/cn";

const ITEM =
  "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-small font-semibold text-ink no-underline outline-none " +
  "transition-colors duration-150 data-[highlighted]:bg-teal-soft data-[highlighted]:text-teal-ink dark:data-[highlighted]:text-teal [&_svg]:size-4 [&_svg]:text-ink-2";

export interface CaseMenuProps {
  caseId: string;
  /** The case name ("Ehlers-Danlos syndrome"). Falls back to "Your case". */
  caseName?: string | null;
}

/**
 * The case header's one menu (docs/DESIGN-v2.md 5.2): the case name as the trigger; inside, the case home and the
 * site links that used to crowd the header.
 */
export function CaseMenu({ caseId, caseName }: CaseMenuProps) {
  const name = caseName?.trim() || "Your case";
  const links = [
    { href: `/cases/${caseId}`, label: "Case home", Icon: FolderOpen },
    { href: "/calendar", label: "Appointments", Icon: CalendarDays },
    { href: "/start", label: "Start a new case", Icon: Plus },
    { href: "/how-it-works", label: "How it works", Icon: Info },
    { href: "/trust", label: "Trust & safety", Icon: ShieldCheck },
    { href: "/", label: "Wayfinder home", Icon: House },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Case menu: ${name}`}
        className={cn(
          "inline-flex h-10 min-w-0 max-w-[min(18rem,40vw)] cursor-pointer items-center gap-1.5 rounded-sm px-2 text-small font-semibold text-ink",
          "transition-colors duration-150 hover:bg-paper-2 focus-ring data-[state=open]:bg-paper-2",
        )}
      >
        {/* Phones show "Case" (the judge stage bar repeats the name there); the name returns from 640 px. */}
        <span className="min-w-0 truncate max-sm:sr-only">{name}</span>
        <span aria-hidden className="sm:hidden">Case</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-2" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-60 rounded-md border border-line bg-card p-1.5 text-ink shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <DropdownMenu.Label className="truncate px-3 pb-1 pt-2 text-small text-ink-2">{name}</DropdownMenu.Label>
          {links.map(({ href, label, Icon }, index) => (
            <Fragment key={href}>
              {index === 1 ? <DropdownMenu.Separator className="my-1 h-px bg-line" /> : null}
              <DropdownMenu.Item asChild className={ITEM}>
                <Link href={href}>
                  <Icon aria-hidden />
                  {label}
                </Link>
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
