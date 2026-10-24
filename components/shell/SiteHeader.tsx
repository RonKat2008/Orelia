"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/ui/cn";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

export interface NavItem {
  href: string;
  label: string;
}

export const MARKETING_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/trust", label: "Trust" },
  { href: "/about", label: "About" },
];

/** Header nav for case pages: the four always-available destinations. */
export const CASE_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/start", label: "Start a case" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/trust", label: "Trust & safety" },
];

export interface SiteHeaderProps {
  nav?: NavItem[];
  /** Primary call to action. Defaults to starting a case. */
  cta?: NavItem | null;
  className?: string;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Calm sticky header: translucent paper with blur, hairline underneath. */
export function SiteHeader({ nav = MARKETING_NAV, cta = { href: "/start", label: "Start a case" }, className }: SiteHeaderProps) {
  const pathname = usePathname() ?? "/";

  return (
    <header
      data-slot="site-header"
      className={cn(
        "sticky top-0 z-40 border-b border-line/80 bg-paper/80 backdrop-blur-md backdrop-saturate-150",
        "supports-[not(backdrop-filter:blur(1px))]:bg-paper",
        className,
      )}
    >
      <a
        href="#main"
        className="sr-only rounded-sm bg-card px-4 py-2 text-small font-semibold text-ink shadow-md focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus-ring"
      >
        Skip to content
      </a>
      <div className="page-container flex h-16 items-center gap-6 sm:h-18">
        <Wordmark />

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-sm px-3 py-2 text-small font-semibold text-ink-2 no-underline transition-colors duration-150",
                  "hover:text-ink focus-ring",
                  "after:absolute after:inset-x-3 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-teal",
                  "after:transition-transform after:duration-300 after:ease-out-expo hover:after:scale-x-100",
                  active && "text-ink after:scale-x-100",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <ThemeToggle className="hidden sm:inline-flex" />
          {cta ? (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ) : null}
          <div className="md:hidden">
            <Sheet
              title="Menu"
              trigger={
                <IconButton label="Open menu">
                  <Menu aria-hidden />
                </IconButton>
              }
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
                      aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      className="flex min-h-12 items-center border-b border-line font-display text-h3 text-ink no-underline focus-ring aria-[current=page]:text-teal"
                    >
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-6 flex items-center justify-between gap-4">
                <span className="text-small font-semibold text-ink-2">Theme</span>
                <ThemeToggle />
              </div>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
