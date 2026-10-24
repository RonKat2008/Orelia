import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button, EmptyState as EmptyPanel, LoadingState, Skeleton } from "@/components/ui";

/** Loading placeholder shaped like the content that is coming. Announced once, politely; says so if it is slow. */
export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <LoadingState label={label} className="gap-4 py-2">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-24 w-4/5 rounded-md" />
    </LoadingState>
  );
}

/** Quiet, left-aligned empty state (docs/DESIGN-v2.md 6): what will appear, when, and at most one action. */
export function EmptyState({
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div role="status">
      <EmptyPanel
        title={title}
        description={detail}
        action={
          actionHref && actionLabel ? (
            <Button asChild variant="secondary">
              <Link href={actionHref}>{actionLabel}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** A real error: red edge, icon and words, a retry, and at most one way out. */
export function ErrorState({
  title,
  detail,
  onRetry,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger-soft p-4">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="grid min-w-0 gap-2">
        <p className="m-0 text-body font-semibold text-ink">{title}</p>
        <p className="m-0 max-w-prose text-small text-ink-2 text-pretty">{detail}</p>
        {onRetry || (actionHref && actionLabel) ? (
          <div className="flex flex-wrap items-center gap-4">
            {onRetry ? (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {actionHref && actionLabel ? (
              <Button asChild variant="link" size="sm">
                <Link href={actionHref}>{actionLabel}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StateRegion({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}
