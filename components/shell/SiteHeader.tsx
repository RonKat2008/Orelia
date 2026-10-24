"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { AccountMenu } from "./AccountMenu";
import { MobileMenu } from "./MobileMenu";
import { isNavItemActive, type NavItem } from "./nav";
import { ThemeToggle } from "./ThemeToggle";
import { ViewToggle } from "@/components/view-mode/ViewToggle";
import { Wordmark } from "./Wordmark";

export type { NavItem } from "./nav";

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
  { href: "/calendar", label: "Appointments" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/trust", label: "Trust & safety" },
];

export interface SiteHeaderProps {
  nav?: NavItem[];
  /** Primary call to action. Defaults to starting a case. */
  cta?: NavItem | null;
  className?: string;
  /** Show the "Patient view / Judge view" switch (landing, /start and case pages). */
  viewToggle?: boolean;
}

/** Calm sticky header: translucent paper with blur, hairline underneath. */
export function SiteHeader({ nav = MARKETING_NAV, cta = { href: "/start", label: "Start a case" }, className, viewToggle = false }: SiteHeaderProps) {
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
      <div className="page-container flex h-16 items-center gap-3 sm:h-18 sm:gap-6">
        <Wordmark compact={viewToggle} />

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = isNavItemActive(pathname, item.href);
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

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3 md:ml-0">
          {viewToggle ? <ViewToggle /> : null}
          <AccountMenu />
          <ThemeToggle className="hidden sm:inline-flex" />
          {cta ? (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ) : null}
          <div className="md:hidden">
            <MobileMenu nav={nav} cta={cta} pathname={pathname} />
          </div>
        </div>
      </div>
    </header>
  );
}
