import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, Inbox } from "lucide-react";
import { Button, EmptyState as EmptyPanel, Skeleton } from "@/components/ui";

/** Loading placeholder shaped like the content that is coming. Announced once, politely. */
export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-4 py-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-4/5 rounded-lg" />
    </div>
  );
}

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
        icon={<Inbox />}
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
    <div role="alert" className="flex gap-4 rounded-lg border border-danger/30 bg-danger-soft p-5 sm:p-6">
      <CircleAlert aria-hidden className="mt-1 size-5 shrink-0 text-danger" />
      <div className="grid min-w-0 gap-3">
        <p className="m-0 font-display text-h4 font-normal text-ink display-soft">{title}</p>
        <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">{detail}</p>
        {onRetry || (actionHref && actionLabel) ? (
          <div className="flex flex-wrap gap-3">
            {onRetry ? (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {actionHref && actionLabel ? (
              <Button asChild variant="ghost" size="sm">
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
