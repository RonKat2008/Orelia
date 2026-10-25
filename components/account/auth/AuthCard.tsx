import type { ReactNode } from "react";
export function AuthCard({ title, lede, children, footer }: { title: string; lede?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-labelledby="auth-title" className="grid w-full min-w-0 max-w-md gap-6 animate-rise motion-reduce:animate-none">
      <header className="grid gap-2">
        <h1 id="auth-title" className="m-0 font-display text-h1 font-light text-ink display-soft text-balance">
          {title}
        </h1>
        {lede ? <p className="m-0 text-body text-ink-2 text-pretty">{lede}</p> : null}
      </header>
      {children}
      {footer ? <footer className="border-t border-line pt-5 text-body text-ink-2">{footer}</footer> : null}
    </section>
  );
}

export const AUTH_LINK =
  "rounded-sm font-semibold text-teal underline decoration-teal/35 underline-offset-[0.22em] hover:text-teal-ink hover:decoration-teal-ink focus-ring";
