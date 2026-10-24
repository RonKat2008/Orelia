import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/shell";

/** Shared frame for the auth pages: header, a single centred card, footer. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="ds-root min-h-dvh bg-paper text-ink">
      <SiteHeader cta={null} />
      <main id="main" className="page-container grid justify-items-center pb-section pt-10 sm:pt-16">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function AuthCard({ title, lede, children, footer }: { title: string; lede?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section
      aria-labelledby="auth-title"
      className="grid w-full max-w-md min-w-0 gap-6 rounded-lg border border-line bg-card p-6 shadow-md sm:p-9 animate-rise motion-reduce:animate-none"
    >
      <header className="grid gap-2">
        <h1 id="auth-title" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
          {title}
        </h1>
        {lede ? <p className="m-0 text-body text-ink-2 text-pretty">{lede}</p> : null}
      </header>
      {children}
      {footer ? <footer className="border-t border-line pt-5 text-small text-ink-2">{footer}</footer> : null}
    </section>
  );
}

export const AUTH_LINK =
  "rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink hover:decoration-teal-ink focus-ring";
