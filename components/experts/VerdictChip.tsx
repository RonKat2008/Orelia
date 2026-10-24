import { CircleDashed, ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui";
import type { ChainVerdict, ExpertTrace } from "@/lib/experts/contract";
import { SourceLinks } from "./SourceLinks";
import { safeHref, verdictView } from "./view-model";

export function VerdictChip({
  kind,
  verdict,
  text,
  evidenceIds,
  trace,
  url,
  urlLabel,
}: {
  kind: "sees" | "consult";
  verdict: ChainVerdict;
  text: string;
  evidenceIds: readonly string[];
  trace: Pick<ExpertTrace, "evidence">;
  url?: string | null;
  urlLabel?: string;
}) {
  const view = verdictView(kind, verdict);
  const Icon = verdict === "yes" ? ShieldCheck : verdict === "no" ? ShieldAlert : CircleDashed;
  const href = safeHref(url);
  return (
    <div className="grid min-w-0 gap-2">
      <Badge tone={view.tone} className="h-auto min-h-6 whitespace-normal py-1 leading-tight">
        <Icon aria-hidden />
        {view.label}
      </Badge>
      {verdict === "unknown" ? null : <p className="m-0 text-small text-ink-2 text-pretty">{text}</p>}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-small font-semibold text-teal underline-offset-4 hover:underline focus-ring"
        >
          {urlLabel ?? "Program page"}
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
      <SourceLinks trace={trace} ids={evidenceIds} />
    </div>
  );
}
