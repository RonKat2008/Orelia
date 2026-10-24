import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import { formatGenerated } from "./model";

export interface BriefHeaderProps {
  brief: ConditionBrief;
  busy: boolean;
  onRefresh: () => void;
}

export function BriefHeader({ brief, busy, onRefresh }: BriefHeaderProps) {
  const generated = formatGenerated(brief.generatedAt);
  const dropped = brief.dropped.length;
  return (
    <header className="grid gap-5">
      <p className="m-0 text-micro font-semibold uppercase text-ink-3">Condition brief</p>
      <h2 className="display-soft m-0 max-w-[22ch] text-balance font-display text-h1 text-ink">
        What the public sources say about <em className="emph">{brief.diseaseName}</em>
      </h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {generated ? <p className="m-0 text-small text-ink-2">Generated {generated}</p> : null}
        {brief.mode === "offline" ? <Badge tone="sage">Recorded sources</Badge> : null}
        {dropped > 0 ? (
          <p className="m-0 text-small text-ink-2">
            {dropped} {dropped === 1 ? "item" : "items"} removed by our source check
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onRefresh} loading={busy} loadingText="Refreshing">
          <RefreshCw aria-hidden className="size-4" />
          Refresh
        </Button>
      </div>
    </header>
  );
}
