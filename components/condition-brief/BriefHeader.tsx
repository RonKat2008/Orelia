import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import { formatGenerated } from "./model";

export interface BriefHeaderProps {
  brief: ConditionBrief;
  busy: boolean;
  onRefresh: () => void;
}

/** Heading level of the page title: h2 while the case shell still prints the h1 (lane A part 2 flips this). */
export const CASE_PAGE_HEADING = "h2" as const;

export function BriefHeader({ brief, busy, onRefresh }: BriefHeaderProps) {
  const generated = formatGenerated(brief.generatedAt);
  const dropped = brief.dropped.length;
  const facts = [
    generated ? `Generated ${generated}` : null,
    brief.mode === "offline" ? "Recorded sources" : null,
    dropped > 0 ? `${dropped} ${dropped === 1 ? "item" : "items"} removed by our source check` : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-3">
      <PageHeader
        as={CASE_PAGE_HEADING}
        eyebrow="Condition brief"
        title={`What the public sources say about ${brief.diseaseName}`}
        lede="A plain summary. Every line shows where it came from."
        className="mb-0"
        action={
          <Button variant="link" className="min-h-11 text-body" onClick={onRefresh} loading={busy} loadingText="Refreshing">
            <RefreshCw aria-hidden className="size-4" />
            Refresh
          </Button>
        }
      />
      {facts.length > 0 ? <p className="m-0 text-small text-ink-2">{facts.join(" · ")}</p> : null}
    </div>
  );
}
