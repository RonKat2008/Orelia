import type { ReactNode } from "react";
import "./states.css";

export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="wf-state" role="status" aria-live="polite" aria-busy="true">
      <span className="wf-sr">{label}</span>
      <div className="wf-skel" />
      <div className="wf-skel" />
      <div className="wf-skel wf-skel-short" />
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
    <div className="wf-state" role="status">
      <p className="wf-state-title">{title}</p>
      <p>{detail}</p>
      {actionHref && actionLabel ? (
        <a className="wf-state-action" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
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
    <div className="wf-state" role="alert">
      <p className="wf-state-title">{title}</p>
      <p>{detail}</p>
      <div className="wf-state-actions">
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {actionHref && actionLabel ? (
          <a className="wf-state-action" href={actionHref}>
            {actionLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function StateRegion({ children }: { children: ReactNode }) {
  return <div className="wf-state-slot">{children}</div>;
}
