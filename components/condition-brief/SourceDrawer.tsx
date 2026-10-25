"use client";

import { ExternalLink } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import type { BriefSource } from "@/lib/condition-brief/contract";
import { DESIGN_PLAIN, fetchedDate, kindLabel, safeHref } from "./model";

/** The drawer body. Excerpts are third-party text: rendered as plain text only. */
export function SourceDetails({ source }: { source: BriefSource }) {
  const href = safeHref(source.url);
  const fetched = fetchedDate(source);
  return (
    <div className="grid gap-5">
      <dl className="m-0 grid gap-3 text-small">
        <Row term="From">{[kindLabel(source.kind), source.publisher].filter(Boolean).join(" · ")}</Row>
        {source.year ? <Row term="Year">{source.year}</Row> : null}
        {fetched ? <Row term="Fetched by Orelia">{fetched}</Row> : null}
        <Row term="What kind of source">{DESIGN_PLAIN[source.design]}</Row>
      </dl>
      {source.excerpt ? (
        <figure className="m-0 grid gap-1.5">
          <figcaption className="text-small text-ink-3">Excerpt we read</figcaption>
          <blockquote className="m-0 whitespace-pre-wrap border-l-2 border-line-strong pl-4 text-small text-ink-2">
            {source.excerpt}
          </blockquote>
        </figure>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-sm font-semibold text-teal underline-offset-4 hover:underline focus-ring"
        >
          Open the original
          <ExternalLink aria-hidden className="size-4" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small text-ink-3">{term}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

export interface SourceDrawerProps {
  source: BriefSource | null;
  onClose: () => void;
}

export function SourceDrawer({ source, onClose }: SourceDrawerProps) {
  return (
    <Sheet
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={source?.title ?? "Source"}
      description="Where this statement comes from."
    >
      {source ? <SourceDetails source={source} /> : null}
    </Sheet>
  );
}
