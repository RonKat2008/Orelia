'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Secondary text clamped to two lines, with a "Show more" toggle that appears only when the text actually overflows.
 * Server markup is the clamped text without the toggle; the overflow check runs after mount and on resize.
 */
export function ClampText({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, children]);

  return (
    <div className={cn('grid min-w-0 justify-items-start gap-0.5', className)}>
      <p id={id} ref={ref} className={cn('m-0 max-w-[72ch] text-small text-ink-2 text-pretty', !expanded && 'line-clamp-2')}>
        {children}
      </p>
      {overflows || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(v => !v)}
          className="focus-ring rounded-sm text-small font-semibold text-teal underline-offset-4 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}
