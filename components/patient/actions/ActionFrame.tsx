import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui";

/** The one primary action card: a title, the work, and a quiet "See details" link to the judge page. */
export function ActionFrame({
  title,
  lede,
  detailsHref,
  children,
  kind,
}: {
  title: string;
  lede?: ReactNode;
  detailsHref?: string;
  children: ReactNode;
  kind: string;
}) {
  return (
    <Card
      variant="raised"
      padding="lg"
      data-testid="patient-action"
      data-action={kind}
      aria-labelledby="patient-action-title"
      className="grid grid-cols-[minmax(0,1fr)] gap-6 border-t-4 border-t-teal"
    >
      <div className="grid gap-2">
        <h2 id="patient-action-title" className="m-0 font-display text-h2 font-normal text-ink display-soft text-balance">
          {title}
        </h2>
        {lede ? <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">{lede}</p> : null}
      </div>
      {children}
      {detailsHref ? (
        <p className="m-0 text-small">
          <Link href={detailsHref} className="inline-flex items-center gap-1 rounded-sm font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-teal-ink focus-ring">
            See details <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

export function ActionError({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul role="alert" className="m-0 grid list-none gap-1 rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

export interface ActionProps {
  caseId: string;
  onDone: () => Promise<void>;
}
