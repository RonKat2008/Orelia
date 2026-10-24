'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { useReducedMotionGate } from '@/lib/motion/MotionPreference';
import { DURATION, EASE } from '@/lib/motion/tokens';
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
      className={cn('inline-flex min-h-8 items-center gap-1 rounded-sm text-small font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring', className)}
    >
      {label}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Gentle fade-up on mount; renders in place when reduced motion is on. */
export function Reveal({ children, className, index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  const reduced = useReducedMotionGate();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: DURATION.normal, ease: EASE.arrive, delay: Math.min(index, 6) * 0.04 }}
    >
      {children}
    </motion.div>
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

export function PanelHeading({ id, eyebrow, title, lede }: { id: string; eyebrow: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <header className="grid max-w-3xl gap-2">
      <p className="m-0 text-micro font-semibold uppercase text-ink-3">{eyebrow}</p>
      <h3 id={id} className="m-0 font-display text-h3 font-light text-ink display-soft text-balance">{title}</h3>
      {lede ? <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{lede}</p> : null}
    </header>
  );
}

export const LOADING_LINE = 'Loading…';
