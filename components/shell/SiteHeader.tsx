"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { AccountMenu, SignInLink } from "./AccountMenu";
import { MobileMenu } from "./MobileMenu";
import { ThemeButton } from "./ThemeButton";
import { isNavItemActive, type NavItem } from "./nav";
import { ViewToggle } from "@/components/view-mode/ViewToggle";
import { Wordmark } from "./Wordmark";

export type { NavItem } from "./nav";

/** Marketing nav (docs/DESIGN-v2.md 6): three items; the wordmark is the way home. */
export const MARKETING_NAV: NavItem[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/trust", label: "Trust" },
  { href: "/about", label: "About" },
];

/** Links the case menu offers besides the case itself. Kept for callers that still pass it as `nav`. */
export const CASE_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/start", label: "Start a new case" },
  { href: "/calendar", label: "Appointments" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/trust", label: "Trust & safety" },
];

export interface SiteHeaderProps {
  nav?: NavItem[];
  /** Primary call to action. Defaults to starting a case. Pass null on /start and case pages. */
  cta?: NavItem | null;
  className?: string;
  /** Show the "Patient / Judge" switch (landing, /start and case pages). */
  viewToggle?: boolean;
  /**
   * Hide the header CTA while an element matching this selector is on screen (the landing hero, "[data-hero]"),
   * so there is one "start" button per screen. The slot keeps its width: no layout shift.
   */
  ctaHideWhileVisible?: string;
  /** Case pages: the case menu replaces the marketing nav, the CTA and the phone menu. */
  caseMenu?: ReactNode;
}

/** True while any element matching `selector` intersects the viewport (false when there is none). */
function useInView(selector: string | undefined): boolean {
  const [inView, setInView] = useState(Boolean(selector));
  useEffect(() => {
    if (!selector) return;
    const targets = Array.from(document.querySelectorAll(selector));
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") {
      // Nothing to watch: show the CTA (deferred so the effect only subscribes).
      const frame = window.requestAnimationFrame(() => setInView(false));
      return () => window.cancelAnimationFrame(frame);
    }
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setInView(visible.size > 0);
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [selector]);
  return Boolean(selector) && inView;
}

function MarketingNav({ nav, pathname, wideOnly }: { nav: NavItem[]; pathname: string; wideOnly: boolean }) {
  return (
    <nav aria-label="Main" className={cn("ml-auto hidden items-center gap-1", wideOnly ? "lg:flex" : "md:flex")}>
      {nav.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap rounded-sm px-3 py-2 text-small font-semibold text-ink-2 no-underline transition-colors duration-150",
              "hover:text-ink focus-ring",
              "after:absolute after:inset-x-3 after:bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-pill after:bg-teal",
              "after:transition-transform after:duration-300 after:ease-out-expo hover:after:scale-x-100 motion-reduce:after:transition-none",
              active && "text-ink after:scale-x-100",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Calm sticky header: translucent paper with blur, hairline underneath. Never wraps: every label is nowrap, the
 * marketing nav collapses into the phone menu below 1024 px (768 px without the view switch), and case pages swap
 * the nav for one case menu. A one-tap light/dark button sits beside the account menu.
 */
export function SiteHeader({
  nav = MARKETING_NAV,
  cta = { href: "/start", label: "Start a case" },
  className,
  viewToggle = false,
  ctaHideWhileVisible,
  caseMenu,
}: SiteHeaderProps) {
  const pathname = usePathname() ?? "/";
  const ctaHidden = useInView(ctaHideWhileVisible);
  const isCase = Boolean(caseMenu);
  const wideOnly = viewToggle;

  return (
    <header
      data-slot="site-header"
      className={cn(
        "sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur-md backdrop-saturate-150",
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
      <div className="page-container flex h-16 items-center gap-3 sm:gap-6">
        <Wordmark compact={viewToggle || isCase} />

        {isCase ? <div className="flex min-w-0 items-center">{caseMenu}</div> : <MarketingNav nav={nav} pathname={pathname} wideOnly={wideOnly} />}

        <div
          className={cn(
            "flex shrink-0 items-center gap-2 sm:gap-3",
            isCase ? "ml-auto" : wideOnly ? "ml-auto lg:ml-0" : "ml-auto md:ml-0",
          )}
        >
          {viewToggle ? <ViewToggle /> : null}
          {isCase ? null : <SignInLink />}
          <ThemeButton />
          <AccountMenu />
          {cta && !isCase ? (
            <Button
              asChild
              size="sm"
              className={cn("hidden whitespace-nowrap sm:inline-flex", ctaHidden && "invisible")}
              aria-hidden={ctaHidden || undefined}
              tabIndex={ctaHidden ? -1 : undefined}
              data-cta-hidden={ctaHidden || undefined}
            >
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ) : null}
          {isCase ? null : (
            <div className={wideOnly ? "lg:hidden" : "md:hidden"}>
              <MobileMenu nav={nav} cta={cta} pathname={pathname} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
