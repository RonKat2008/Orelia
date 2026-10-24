"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import { MobileAccountLinks } from "./AccountMenu";
import { isNavItemActive, type NavItem } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

export interface MobileMenuSheetProps {
  nav: NavItem[];
  cta: NavItem | null;
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The phone menu drawer. Loaded on demand by MobileMenu, so vaul and the Radix
 * dialog stay out of the first-paint bundle.
 */
export function MobileMenuSheet({ nav, cta, pathname, open, onOpenChange }: MobileMenuSheetProps) {
  return (
    <Sheet
      title="Menu"
      open={open}
      onOpenChange={onOpenChange}
      footer={
        cta ? (
          <SheetClose>
            <Button asChild size="lg" className="w-full">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          </SheetClose>
        ) : undefined
      }
    >
      <nav aria-label="Main" className="grid">
        {nav.map((item) => (
          <SheetClose key={item.href}>
            <Link
              href={item.href}
              aria-current={isNavItemActive(pathname, item.href) ? "page" : undefined}
              className="flex min-h-12 items-center border-b border-line font-display text-h3 text-ink no-underline focus-ring aria-[current=page]:text-teal"
            >
              {item.label}
            </Link>
          </SheetClose>
        ))}
      </nav>
      <MobileAccountLinks />
      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-small font-semibold text-ink-2">Theme</span>
        <ThemeToggle />
      </div>
    </Sheet>
  );
}
