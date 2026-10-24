'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/ui/cn';
import { isSafeHttpUrl } from './model';

/** "Source" link: opens in a new tab, says so to screen readers. */
export function SourceLink({ url, label = 'Source', className }: { url: string; label?: string; className?: string }) {
  if (!isSafeHttpUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex min-h-11 items-center gap-1 rounded-sm text-small font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring', className)}
    >
      {label}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Polite live region for async status. */
export function Live({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="m-0 min-h-5 text-small text-ink-2">
      {children}
    </p>
  );
}

/** Section heading for the coordinate page: one text-h3 heading and at most one sentence. */
export function PanelHeading({ id, title, lede }: { id: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <header className="grid max-w-prose gap-2">
      <h3 id={id} className="m-0 font-display text-h3 font-normal text-ink text-balance">{title}</h3>
      {lede ? <p className="m-0 text-body text-ink-2 text-pretty">{lede}</p> : null}
    </header>
  );
}

export const LOADING_LINE = 'Loading…';
